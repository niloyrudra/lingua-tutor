#!/usr/bin/env node
/**
 * Setup helper — checks that required tools are available
 * and gives clear instructions if anything is missing.
 */

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";

const execAsync = promisify(exec);

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

const ok = msg => console.log(`  ${GREEN}✓${RESET} ${msg}`);
const fail = msg => console.log(`  ${RED}✗${RESET} ${msg}`);
const warn = msg => console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
const info = msg => console.log(`  ${CYAN}→${RESET} ${msg}`);

async function check(name, cmd, installMsg) {
  try {
    await execAsync(cmd);
    ok(name);
    return true;
  } catch {
    fail(`${name} not found`);
    if (installMsg) info(installMsg);
    return false;
  }
}

async function main() {
  console.log(`\n${BOLD}🌍 Lingua Tutor — Setup Check${RESET}\n`);

  // Copy .env if missing
  if (!fs.existsSync(".env")) {
    fs.copyFileSync(".env.example", ".env");
    ok("Created .env from .env.example");
  } else {
    ok(".env file exists");
  }

  console.log(`\n${BOLD}Node / npm${RESET}`);
  await check("Node.js", "node --version", "Install from https://nodejs.org");
  await check("npm", "npm --version", null);

  console.log(`\n${BOLD}Python (for local STT + TTS)${RESET}`);
  const hasPython = await check("Python 3", "python3 --version", "Install from https://python.org");

  if (hasPython) {
    const hasFasterWhisper = await check(
      "faster-whisper",
      'python3 -c "import faster_whisper"',
      "pip install faster-whisper"
    );

    if (!hasFasterWhisper) {
      await check("openai-whisper (fallback)", 'python3 -c "import whisper"', "pip install openai-whisper");
    }

    const hasKokoro = await check("kokoro (TTS)", 'python3 -c "import kokoro"', "pip install kokoro soundfile");

    if (!hasKokoro) {
      await check(
        "edge-tts (TTS fallback)",
        'python3 -c "import edge_tts"',
        "pip install edge-tts  ← easier fallback, decent quality"
      );
    }
  }

  console.log(`\n${BOLD}Ollama (local LLM)${RESET}`);
  const hasOllama = await check("Ollama", "ollama --version", "Install from https://ollama.com");

  if (hasOllama) {
    try {
      const { stdout } = await execAsync("ollama list");
      const models = stdout.split("\n").filter(l => l.trim() && !l.startsWith("NAME"));
      if (models.length > 0) {
        ok(
          `Models available: ${models
            .slice(0, 3)
            .map(m => m.split(" ")[0])
            .join(", ")}`
        );
      } else {
        warn("No Ollama models installed");
        info("Run: ollama pull llama3.2");
      }
    } catch {
      // ollama list failed; ignore
    }
  }

  console.log(`\n${BOLD}Summary${RESET}`);
  console.log(`
  The minimum to get started locally:
  ${CYAN}1.${RESET} Ollama running:          ${YELLOW}ollama serve${RESET}
  ${CYAN}2.${RESET} A model pulled:          ${YELLOW}ollama pull llama3.2${RESET}
  ${CYAN}3.${RESET} Whisper installed:       ${YELLOW}pip install faster-whisper${RESET}
  ${CYAN}4.${RESET} A TTS engine:            ${YELLOW}pip install edge-tts${RESET}  (easiest)
                            ${YELLOW}pip install kokoro soundfile${RESET}  (better quality)

  Then start the server:    ${YELLOW}npm run dev${RESET}
  Open:                     ${YELLOW}http://localhost:3000${RESET}

  To use cloud providers, add keys to ${YELLOW}.env${RESET} and change the *_PROVIDER vars.
  `);
}

main();
