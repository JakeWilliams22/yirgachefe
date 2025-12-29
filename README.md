# yirgachefe ☕

Create a "Year-In-Review" for any data you can export.

## Motivation

This project was born from three ideas:

1. **Spotify Wrapped is delightful** - and many services have followed suit with their own year-in-review experiences
2. **Not everyone gets a wrapped** - Many services don't (or can't) provide years-in-review. There's also something fun about summarizing data people may not want, like the recent [SNL "UberEats Wrapped" sketch](https://youtu.be/Hx7Vv5pqpHg)
3. **GDPR gives you the data** - In most countries, services are legally required to provide your exported usage data in a timely manner

Yirgachefe works with traditional sources like music and video streaming services, or you can get creative with terminal history, fitness trackers, food delivery apps, local git commit history, or any other structured data you have access to.

## How it works

Yirgachefe uses a three-agent system powered by Claude to understand and visualize arbitrary data exports:

1. **Select your data** - Choose a directory containing your exported data (unzipped)
2. **Exploration Agent** - Analyzes the structure and contents of your data to understand what it is and who it belongs to
3. **Analysis Agent** - Generates insights and writes in-browser JavaScript to extract interesting patterns from your data
4. **Presentation Agent** - Creates an interactive, iframe-based presentation with your findings in a fun, 2005-era PowerPoint style

The entire process happens locally in your browser using the File System Access API, with Claude models (Sonnet 4.5 and Opus 4.5) orchestrating the analysis.

## Privacy & Data Handling

If you bring your own API key, all data processing happens directly in your browser and through the Anthropic API. Your data never touches any other backend.

- ✅ All file access stays local using the File System Access API
- ✅ State stored in your browser's local storage
- ✅ Only API calls are to Claude (for analysis) and Umami (anonymized usage stats)
- ⚠️ This code is almost entirely AI-generated and has not been security-audited
- ⚠️ The app executes LLM-generated code on your data

**Use at your own risk.** This is a demonstration project exploring what's possible with the latest AI coding tools and Claude models.

## Development

Built with React + TypeScript + Vite.

```bash
npm install
npm run dev
```

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **AI Models**: Claude Sonnet 4.5 & Opus 4.5 (via Anthropic API)
- **File Access**: File System Access API
- **Code Execution**: In-browser JavaScript evaluation with sandboxed iframes
- **Analytics**: Umami (self-hosted, privacy-focused)
