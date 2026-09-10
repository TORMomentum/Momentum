#!/usr/bin/env node
// GitHub leaves broken Mermaid blocks looking like ordinary Markdown in review;
// parse them here so a documentation change cannot hide a diagram that will not render.

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";

const cwd = process.cwd();
const dom = new JSDOM("<!doctype html><html><body></body></html>");

for (const key of [
  "window",
  "document",
  "navigator",
  "DOMParser",
  "Element",
  "HTMLElement",
  "SVGElement",
  "Node",
  "getComputedStyle",
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: dom.window[key],
  });
}

const { default: mermaid } = await import("mermaid");
mermaid.initialize({ startOnLoad: false });

async function markdownFiles(target) {
  const targetStat = await stat(target);
  if (targetStat.isFile()) return path.extname(target) === ".md" ? [target] : [];

  const entries = await readdir(target, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(target, entry.name);
      if (entry.isDirectory()) return markdownFiles(entryPath);
      return path.extname(entry.name) === ".md" ? [entryPath] : [];
    }),
  );
  return files.flat();
}

function mermaidBlocks(content) {
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let startLine;
  let source = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (startLine === undefined && /^\s*```mermaid\s*$/i.test(lines[index])) {
      startLine = index + 1;
      source = [];
    } else if (startLine !== undefined && /^\s*```\s*$/.test(lines[index])) {
      blocks.push({ line: startLine, source: source.join("\n") });
      startLine = undefined;
    } else if (startLine !== undefined) {
      source.push(lines[index]);
    }
  }

  return blocks;
}

function diagramType(source) {
  return source.match(/^\s*([A-Za-z][\w-]*)/)?.[1] ?? "unknown";
}

function displayPath(filePath) {
  const relative = path.relative(cwd, filePath);
  return (relative && !relative.startsWith("..") ? relative : filePath).split(path.sep).join("/");
}

function oneLine(message) {
  return message.replace(/\s+/g, " ").trim();
}

const requestedPaths = process.argv.slice(2);
const targets = requestedPaths.length > 0 ? requestedPaths : ["docs", "README.md"];
const files = (await Promise.all(targets.map((target) => markdownFiles(path.resolve(cwd, target))))).flat();
let blocksChecked = 0;
let failures = 0;

for (const filePath of files.sort()) {
  const content = await readFile(filePath, "utf8");
  for (const block of mermaidBlocks(content)) {
    blocksChecked += 1;
    const label = `${displayPath(filePath)}:${block.line} ${diagramType(block.source)}`;
    try {
      await mermaid.parse(block.source);
      console.log(`${label} OK`);
    } catch (error) {
      failures += 1;
      console.log(`${label} ${oneLine(error.message ?? String(error))}`);
    }
  }
}

console.log(`\n${blocksChecked} Mermaid block(s) checked; ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
