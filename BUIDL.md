# CaptionWild: BUIDL text for DoraHacks

**Name:** CaptionWild

**Tagline:** Any model. Every caption. Cost under control.

**Short description (one line):**
An AI copywriter for small sellers that writes captions on any model through Otari and shows the cost of every caption.

## Description

Small sellers write the same copy every day: a shop listing, an Instagram caption, a TikTok caption, a pin. AI writers help, but they hide two things that matter: which model is doing the work, and what it costs.

CaptionWild turns one product brief into copy for six platforms in your brand voice, and puts model choice and cost in plain sight. Every request goes through **Otari**, Mozilla.ai's open-source LLM gateway:

- **Any model, one endpoint.** The model list comes live from Otari's catalog with a price hint per model. Write with a strong model, run rewrites on a cheap one.
- **Cost of every caption.** Each platform shows the exact cost Otari reports (`usage.cost_usd`), with time and tokens, plus a run total.
- **Spend meter + cap.** A session meter adds up spend. A cap in dollars stops the app before it goes over.
- **Hard budget from Otari.** The real limit lives on the Otari key. When it runs out, Otari refuses the request, and the app explains it.
- **Model duel.** The same brief on two models side by side, with cost, speed and a verdict. The winner becomes the writing model in one click.
- **Spend tags.** Every request is tagged by platform and action, so the Otari dashboard shows where the money goes.

The Otari key stays on the server (a Netlify Function). No framework, no build step, MIT licensed.

## How it uses Otari

- `POST /api/v1/chat/completions` with `provider:model` ids
- `GET /api/v1/models` for the model pickers and prices
- `usage.cost_usd` for cost per platform, run, session and duel
- Key budget enforced by Otari before dispatch
- `metadata` tags for spend per platform/action
- `Otari-Request-ID` passed back for tracing

## Links

- GitHub: https://github.com/ElTanque81/captionwild
- Live demo: https://captionwild.netlify.app
- Demo video: https://youtu.be/bggXsf9O634

## Tech

HTML, CSS, vanilla JS · Netlify Functions (Node) · Otari by Mozilla.ai

## Team

ElTanque81
