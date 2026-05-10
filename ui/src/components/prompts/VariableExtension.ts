import { Node, mergeAttributes } from "@tiptap/core";
import type { Editor, JSONContent } from "@tiptap/core";

export const VariableNode = Node.create({
  name: "variable",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      name: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-variable]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-variable": node.attrs.name,
        class: "prompt-variable-chip",
        contenteditable: "false",
      }),
      `{{${node.attrs.name}}}`,
    ];
  },
});

const VARIABLE_REGEX = /\{\{(\w+)\}\}/g;

export function templateToContent(template: string): JSONContent {
  const doc: JSONContent = {
    type: "doc",
    content: [],
  };

  const lines = template.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const paragraph: JSONContent = {
      type: "paragraph",
      content: [],
    };

    let lastIndex = 0;
    VARIABLE_REGEX.lastIndex = 0;
    let match = VARIABLE_REGEX.exec(line);

    while (match !== null) {
      const before = line.slice(lastIndex, match.index);
      if (before) {
        paragraph.content!.push({ type: "text", text: before });
      }
      paragraph.content!.push({
        type: "variable",
        attrs: { name: match[1] },
      });
      lastIndex = match.index + match[0].length;
      match = VARIABLE_REGEX.exec(line);
    }

    const remaining = line.slice(lastIndex);
    if (remaining) {
      paragraph.content!.push({ type: "text", text: remaining });
    }

    doc.content!.push(paragraph);
  }

  if (doc.content!.length === 0) {
    doc.content!.push({ type: "paragraph", content: [] });
  }

  return doc;
}

export function contentToTemplate(editor: Editor): string {
  const json = editor.getJSON();
  if (!json.content) return "";

  return json.content
    .map((block: JSONContent) => {
      if (!block.content) return "";
      return block.content
        .map((node: JSONContent) => {
          if (node.type === "variable" && node.attrs?.name) {
            return `{{${node.attrs.name as string}}}`;
          }
          return node.text ?? "";
        })
        .join("");
    })
    .join("\n");
}

export function extractVariableNames(template: string): string[] {
  const names: string[] = [];
  VARIABLE_REGEX.lastIndex = 0;
  let match = VARIABLE_REGEX.exec(template);
  while (match !== null) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
    match = VARIABLE_REGEX.exec(template);
  }
  return names;
}
