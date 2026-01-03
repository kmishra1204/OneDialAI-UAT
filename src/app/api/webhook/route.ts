import OpenAI from "openai";
import { and, eq, not } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { ChatCompletionMessageParam } from "openai/resources/index.mjs";
import {
  MessageNewEvent,
  CallEndedEvent,
  CallTranscriptionReadyEvent,
  CallRecordingReadyEvent,
  CallSessionParticipantLeftEvent,
  CallSessionStartedEvent,
} from "@stream-io/node-sdk";

import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { streamVideo } from "@/lib/stream-video";
import { inngest } from "@/inngest/client";
import { generateAvatarUri } from "@/lib/avatar";
import { streamChat } from "@/lib/stream-chat";

/**
 * =============================
 * OpenAI config (Ask-AI only)
 * =============================
 * Recommended env:
 *  - OPENAI_CHAT_MODEL=gpt-4.1
 *  - OPENAI_TEMPERATURE=0.2
 *  - OPENAI_MAX_TOKENS=700
 */
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4.1";
const OPENAI_TEMPERATURE = Number(process.env.OPENAI_TEMPERATURE ?? "0.2");
const OPENAI_MAX_TOKENS = Number(process.env.OPENAI_MAX_TOKENS ?? "700");

// Create once (good)
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/**
 * =============================
 * Webhook retry dedupe (message.new)
 * =============================
 * Stream can retry delivery. Without dedupe, the agent replies multiple times to the same user message.
 * This is best-effort in-memory dedupe. For perfect dedupe on Vercel, we’d store messageId in DB.
 */
const processedMessageIds = new Map<string, number>();
const DEDUPE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function seenRecently(messageId: string): boolean {
  const now = Date.now();

  // GC old entries
  for (const [id, ts] of processedMessageIds.entries()) {
    if (now - ts > DEDUPE_TTL_MS) processedMessageIds.delete(id);
  }

  const ts = processedMessageIds.get(messageId);
  if (ts && now - ts < DEDUPE_TTL_MS) return true;

  processedMessageIds.set(messageId, now);
  return false;
}

function verifySignatureWithSDK(body: string, signature: string): boolean {
  return streamVideo.verifyWebhook(body, signature);
}

/**
 * Optional: stable wrapper to keep “Legal Sevak” tone consistent.
 * Your DB `existingAgent.instructions` remains the primary persona control.
 * If you don’t want any wrapper, set BASE_AGENT_WRAPPER="".
 */
const BASE_AGENT_WRAPPER = process.env.BASE_AGENT_WRAPPER?.trim() || `
You are "Legal Sevak" — a calm, respectful village legal aide (Grama Nyaya Sahayak style).
Your job is to help the user understand their situation and options in simple terms.

Rules:
- You are not a lawyer; provide general guidance and practical next steps.
- Do not invent facts not present in the meeting summary or the chat context.
- If the summary lacks info, say so and ask 1–2 clarifying questions.
- Keep responses concise, structured, and action-oriented.
- When relevant, suggest free resources: Lok Adalat / District Legal Services Authority / local legal aid.
`.trim();

export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-signature");
  const apiKey = req.headers.get("x-api-key");

  // Your existing file checks x-api-key but doesn’t validate it. We keep this behavior (no surprises).
  // If you want to validate it, compare to STREAM_WEBHOOK_API_KEY env.
  if (!signature || !apiKey) {
    return NextResponse.json(
      { error: "Missing signature or API key" },
      { status: 400 }
    );
  }

  const body = await req.text();

  if (!verifySignatureWithSDK(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = (payload as Record<string, unknown>)?.type;

  try {
    if (eventType === "call.session_started") {
      const event = payload as CallSessionStartedEvent;
      const meetingId = event.call.custom?.meetingId;

      if (!meetingId) {
        return NextResponse.json({ error: "Missing meetingId" }, { status: 400 });
      }

      const [existingMeeting] = await db
        .select()
        .from(meetings)
        .where(
          and(
            eq(meetings.id, meetingId),
            not(eq(meetings.status, "completed")),
            not(eq(meetings.status, "active")),
            not(eq(meetings.status, "cancelled")),
            not(eq(meetings.status, "processing"))
          )
        );

      if (!existingMeeting) {
        return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
      }

      await db
        .update(meetings)
        .set({
          status: "active",
          startedAt: new Date(),
        })
        .where(eq(meetings.id, existingMeeting.id));

      const [existingAgent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, existingMeeting.agentId));

      if (!existingAgent) {
        return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      }

      // Connect OpenAI realtime through Stream Video
      const call = streamVideo.video.call("default", meetingId);
      const realtimeClient = await streamVideo.video.connectOpenAi({
        call,
        openAiApiKey: process.env.OPENAI_API_KEY!,
        agentUserId: existingAgent.id,
      });

      // Persona: combine stable wrapper + DB instructions (DB remains primary control)
      const liveInstructions = [
        BASE_AGENT_WRAPPER,
        (existingAgent.instructions || "").trim(),
      ]
        .filter(Boolean)
        .join("\n\n");

      realtimeClient.updateSession({
        instructions: liveInstructions,
      });

    } else if (eventType === "call.session_participant_left") {
      const event = payload as CallSessionParticipantLeftEvent;
      const meetingId = event.call_cid.split(":")[1]; // "type:id"

      if (!meetingId) {
        return NextResponse.json({ error: "Missing meetingId" }, { status: 400 });
      }

      const call = streamVideo.video.call("default", meetingId);
      await call.end();

    } else if (eventType === "call.session_ended") {
      const event = payload as CallEndedEvent;
      const meetingId = event.call.custom?.meetingId;

      if (!meetingId) {
        return NextResponse.json({ error: "Missing meetingId" }, { status: 400 });
      }

      await db
        .update(meetings)
        .set({
          status: "processing",
          endedAt: new Date(),
        })
        .where(and(eq(meetings.id, meetingId), eq(meetings.status, "active")));

    } else if (eventType === "call.transcription_ready") {
      const event = payload as CallTranscriptionReadyEvent;
      const meetingId = event.call_cid.split(":")[1]; // "type:id"

      const [updatedMeeting] = await db
        .update(meetings)
        .set({
          transcriptUrl: event.call_transcription.url,
        })
        .where(eq(meetings.id, meetingId))
        .returning();

      if (!updatedMeeting) {
        return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
      }

      await inngest.send({
        name: "meetings/processing",
        data: {
          meetingId: updatedMeeting.id,
          transcriptUrl: updatedMeeting.transcriptUrl,
        },
      });

    } else if (eventType === "call.recording_ready") {
      const event = payload as CallRecordingReadyEvent;
      const meetingId = event.call_cid.split(":")[1]; // "type:id"

      await db
        .update(meetings)
        .set({
          recordingUrl: event.call_recording.url,
        })
        .where(eq(meetings.id, meetingId));

    } else if (eventType === "message.new") {
      const event = payload as MessageNewEvent;

      const messageId = (event as any).message?.id as string | undefined;
      const userId = event.user?.id;
      const channelId = event.channel_id;
      const text = event.message?.text;

      if (!userId || !channelId || !text) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      // Best-effort dedupe against webhook retries
      if (messageId && seenRecently(messageId)) {
        return NextResponse.json({ status: "ok", deduped: true });
      }

      // In your app, channelId maps to meetingId (keep coupling)
      const [existingMeeting] = await db
        .select()
        .from(meetings)
        .where(and(eq(meetings.id, channelId), eq(meetings.status, "completed")));

      if (!existingMeeting) {
        return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
      }

      const [existingAgent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, existingMeeting.agentId));

      if (!existingAgent) {
        return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      }

      // Don’t respond to yourself
      if (userId === existingAgent.id) {
        return NextResponse.json({ status: "ok" });
      }

      /**
       * Ask-AI persona:
       * - hard stable wrapper (optional)
       * - meeting summary grounding
       * - DB instructions (crucial, preserved)
       */
      const instructions = `
${BASE_AGENT_WRAPPER}

You are helping the user revisit a recently completed meeting.

MEETING SUMMARY (ground truth):
${(existingMeeting.summary || "").trim() || "[No summary available]"}

AGENT INSTRUCTIONS (must follow):
${(existingAgent.instructions || "").trim() || "[No agent instructions set]"}

Rules:
- Base answers on the meeting summary + conversation context.
- If insufficient info, say so and ask 1–2 clarifying questions.
- Be concise and specific; use short bullets when helpful.
`.trim();

      const channel = streamChat.channel("messaging", channelId);
      await channel.watch();

      // Use a bit more history than 5; 12 is still cheap but improves coherence
      const previousMessages = channel.state.messages
        .slice(-12)
        .filter((msg) => msg.text && msg.text.trim() !== "")
        .map<ChatCompletionMessageParam>((message) => ({
          role: message.user?.id === existingAgent.id ? "assistant" : "user",
          content: message.text || "",
        }));

      const GPTResponse = await openaiClient.chat.completions.create({
        model: OPENAI_CHAT_MODEL,
        temperature: OPENAI_TEMPERATURE,
        max_tokens: OPENAI_MAX_TOKENS,
        messages: [
          { role: "system", content: instructions },
          ...previousMessages,
          { role: "user", content: text },
        ],
      });

      const GPTResponseText = GPTResponse.choices?.[0]?.message?.content?.trim();

      if (!GPTResponseText) {
        return NextResponse.json({ error: "No response from GPT" }, { status: 400 });
      }

      const avatarUrl = generateAvatarUri({
        seed: existingAgent.name,
        variant: "botttsNeutral",
      });

      // Await these to avoid races
      await streamChat.upsertUser({
        id: existingAgent.id,
        name: existingAgent.name,
        image: avatarUrl,
      });

      await channel.sendMessage({
        text: GPTResponseText,
        user: {
          id: existingAgent.id,
          name: existingAgent.name,
          image: avatarUrl,
        },
      });
    }

    return NextResponse.json({ status: "ok" });
  } catch (err: any) {
    // Avoid dumping full payloads or secrets
    console.error("Webhook handler error:", err?.message || err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
