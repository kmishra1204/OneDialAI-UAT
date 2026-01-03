# OneDialAI

**AI Agents over Telephony for Extreme Reachability**

OneDialAI is a production-grade platform for deploying **instruction-driven AI agents** that operate over **voice calls, live sessions, and chat**, designed for high-reach, real-world use cases where traditional web-only AI systems fail.

It brings AI agents directly into **human communication channels** — phone calls, live conversations, and post-call follow-ups — enabling trusted, explainable, and domain-aligned assistance at scale.

---

## What Makes OneDialAI Different

Most AI systems are UI-first and text-only.  
OneDialAI is **reach-first**.

It is built for environments where:
- Users may not have reliable internet
- Literacy levels vary
- Phones are more accessible than apps
- Trust, continuity, and accountability matter

The system prioritizes **voice + conversation continuity** over dashboards and gimmicks.

---

## Core Capabilities

### 🎙️ AI Agents on Live Calls
- Real-time AI participation in voice/video calls
- Agents operate based on **explicit instructions (persona)**
- No hard-coded system behavior — instructions define ethics, tone, scope

### 💬 Chat During & After Calls
- Live chat alongside calls
- “Ask AI” mode after call completion
- All responses are grounded in:
  - Call transcript
  - Generated summary
  - Recent conversation history

### 🧠 Grounded Intelligence (No Hallucination by Design)
- Automatic transcription
- Structured meeting summaries
- Post-call answers are limited to recorded facts
- If information is missing, the agent explicitly says so

### ⚙️ Event-Driven & Auditable
- Call lifecycle handled via webhooks
- Background processing with Inngest
- Clear separation between:
  - Live interaction
  - Post-call processing
  - Follow-up intelligence

### 🔐 Secure & Role-Aware
- Authentication via Better Auth
- Agent identities scoped per meeting
- Subscription & entitlement support (Polar)

---

## Industry Use Cases

### ⚖️ Legal Aid & Public Justice (Gram Sevak / Lok Adalat Example)

**Example: Virtual Grama Nyaya Sevak**

A local legal support agent assisting rural citizens via phone:

- Explains land disputes, pensions, labor rights
- Speaks in simple language aligned to local context
- Does **not give legal judgments**
- Encourages escalation to local courts or Lok Adalats when needed

Agent behavior is defined entirely by instructions such as:
- Tone (respectful, patient)
- Scope (informational, not advisory)
- Language style (simple, example-driven)
- Ethical boundaries (no guarantees, no legal outcomes)

This makes the system suitable for:
- District Legal Services Authorities
- NGOs
- Legal awareness programs
- Public grievance helplines

---

### 🏥 Healthcare & Social Support
- First-level triage via calls
- Post-call follow-ups
- Symptom explanation (non-diagnostic)
- Referral guidance

### 📞 Customer Support & Advisory
- Call-based AI assistants
- Post-call clarification and summaries
- Reduced human load without losing accountability

### 🌍 Rural & Low-Bandwidth Deployments
- Voice-first interaction
- Minimal UI dependency
- Works where smartphones are shared or limited

---

## Architecture Overview ( Beta 50 Users Only)
User ↔ Voice / Video Call
↓
Stream (Video + Chat)
↓
AI Agent (Instruction-Driven)
↓
Transcripts & Summaries
↓
Post-Call Intelligence (Ask AI)


**Design principles:**
- Instructions > Prompts
- Recorded facts > AI memory
- Explainability > cleverness

---

## Agent Model (Critical Concept)

Each agent is defined by:
- Name
- Avatar
- **Instructions (persona, scope, ethics)**

Those instructions:
- Control live call behavior
- Control post-call responses
- Are never overridden by hidden system prompts

This ensures:
- Domain alignment
- Legal & ethical safety
- Predictable behavior

---

## Technology Stack

- **Next.js 15 / React 19**
- **OpenAI** (real-time + post-call reasoning)
- **Stream Video & Stream Chat**
- **Drizzle ORM**
- **Inngest** (background workflows)
- **Better Auth**
- **Tailwind v4**
- **Polar** (subscriptions)

---

## Deployment Model

- Designed for **Vercel**
- All secrets managed via platform environment variables
- No credentials committed to source control

---

## Philosophy

OneDialAI is built on a simple belief:

> If an AI agent cannot justify its answer using recorded conversation,  
> it should not answer at all.

This makes it suitable for regulated, sensitive, and public-facing domains.

---

## Status

This repository represents a **stable, production-ready foundation**.
It is intentionally extensible, not over-engineered.

