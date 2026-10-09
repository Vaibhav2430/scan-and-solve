import katex from "katex";
import "katex/dist/katex.min.css";
import { tokenizeMath } from "./math";

export function MathText({ text }: { text: string }) {
  return (
    <span className="math-text">
      {tokenizeMath(text).map((segment, index) => {
        if (segment.type === "text") return <span key={index}>{segment.value}</span>;

        const html = katex.renderToString(segment.value, {
          displayMode: segment.display,
          throwOnError: false,
          strict: "ignore",
          trust: false,
          output: "html"
        });
        return <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </span>
  );
}
