export const SLASH_COMMANDS: { name: string; hint: string }[] = [
  { name: "/clear", hint: "Clear the conversation context" },
  { name: "/compact", hint: "Summarize and compact the context" },
  { name: "/help", hint: "Show available commands" },
  { name: "/model", hint: "Switch the model" },
  { name: "/cost", hint: "Show token/cost usage" },
];

/** When `text` starts with `/`, return commands whose name starts with the typed prefix. */
export function matchSlash(text: string): { name: string; hint: string }[] {
  if (!text.startsWith("/")) return [];
  const prefix = text.split(/\s/)[0]!.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(prefix));
}
