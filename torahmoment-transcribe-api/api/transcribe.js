import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "https://torahmoment.com",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-admin-token",
      ...extraHeaders,
    },
  });
}

function slugify(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    return null;
  }
}

function guessProgramType(category) {
  const c = String(category || "").toLowerCase();
  if (c === "parsha") return "parsha-audio";
  if (c === "mishna") return "mishna";
  return "audio";
}

export async function OPTIONS() {
  return json({ ok: true });
}

export async function POST(request) {
  try {
    const adminToken = request.headers.get("x-admin-token");
    if (!process.env.ADMIN_TOKEN || adminToken !== process.env.ADMIN_TOKEN) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const mp3Url = String(body.url || "").trim();

    if (!mp3Url) {
      return json({ error: "Missing url" }, 400);
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(mp3Url);
    } catch {
      return json({ error: "Invalid URL" }, 400);
    }

    if (!/^https?:$/.test(parsedUrl.protocol)) {
      return json({ error: "Only http/https URLs are allowed" }, 400);
    }

    const audioResp = await fetch(mp3Url);
    if (!audioResp.ok) {
      return json(
        { error: `Could not fetch audio URL (${audioResp.status})` },
        400
      );
    }

    const contentType = audioResp.headers.get("content-type") || "";
    const arrayBuffer = await audioResp.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    // OpenAI speech-to-text file uploads are currently limited to 25 MB
    const maxBytes = 25 * 1024 * 1024;
    if (bytes.length > maxBytes) {
      return json(
        {
          error:
            "Audio file is larger than 25 MB. Trim/compress it first or split it into parts.",
        },
        413
      );
    }

    const filename =
      parsedUrl.pathname.split("/").pop()?.replace(/[^\w.-]/g, "") || "audio.mp3";

    const file = new File([bytes], filename, {
      type: contentType || "audio/mpeg",
    });

    const transcriptResult = await client.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe",
    });

    const transcript = String(transcriptResult.text || "").trim();

    const metaResp = await client.responses.create({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content:
            "You create concise website metadata for Torah audio. Be conservative and accurate. Do not invent sources, dates, or titles that are not reasonably implied by the transcript.",
        },
        {
          role: "user",
          content: `
Return JSON only.

Schema:
{
  "title": string,
  "summary": string,
  "date_guess": string,
  "category_guess": string,
  "parsha_guess": string,
  "tags": string[]
}

Rules:
- title: short and clean for a website
- summary: max 2 sentences
- date_guess: leave empty if unknown
- category_guess must be exactly one of:
  "Parsha", "Halacha", "Hashkafa", "Tefilah", "Mishna", "General"
- parsha_guess: empty if not clearly parsha-related
- tags: 0 to 6 short tags
- Do not use markdown
- JSON only

Transcript:
${transcript}
          `,
        },
      ],
    });

    const metaRaw = metaResp.output_text || "";
    const metaParsed = extractJson(metaRaw) || {};

    const metadata = {
      title: String(metaParsed.title || "Untitled Shiur").trim(),
      summary: String(metaParsed.summary || "").trim(),
      date_guess: String(metaParsed.date_guess || "").trim(),
      category_guess: String(metaParsed.category_guess || "General").trim(),
      parsha_guess: String(metaParsed.parsha_guess || "").trim(),
      tags: Array.isArray(metaParsed.tags)
        ? metaParsed.tags.map((x) => String(x).trim()).filter(Boolean).slice(0, 6)
        : [],
    };

    const slug = slugify(metadata.title || "untitled-shiur");
    const type = guessProgramType(metadata.category_guess);

    const itemTemplate = {
      type,
      title: metadata.title,
      url: mp3Url,
      note: metadata.date_guess,
      summary: metadata.summary,
      tags: metadata.tags,
    };

    return json({
      ok: true,
      source_url: mp3Url,
      detected_content_type: contentType,
      transcript,
      metadata: {
        ...metadata,
        slug,
      },
      item_template: itemTemplate,
      copy_blocks: {
        title: metadata.title,
        summary: metadata.summary,
        transcript,
        json: JSON.stringify(itemTemplate, null, 2),
      },
    });
  } catch (err) {
    return json(
      {
        error: err?.message || "Transcription failed",
      },
      500
    );
  }
}
