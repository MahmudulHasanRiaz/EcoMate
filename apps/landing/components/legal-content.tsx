import React from 'react';
import type { ManagedLegalBlock } from '@/lib/landing-content';
import {
  parseLegalBody,
  type LegalTextSegment,
} from '@/lib/legal';

function renderSegments(segments: LegalTextSegment[], keyPrefix: string) {
  return segments.map((segment, index) =>
    segment.type === 'bold' ? (
      <strong key={`${keyPrefix}-${index}`}>{segment.text}</strong>
    ) : (
      <React.Fragment key={`${keyPrefix}-${index}`}>
        {segment.text}
      </React.Fragment>
    ),
  );
}

/**
 * Render managed legal blocks (CMS Batch 2, item 22) inside the
 * existing `.mk-prose` legal layout — the same <h2>/<p>/<ul> shape as
 * the hardcoded fallback, so managed and fallback pages look identical.
 * All text renders as React text nodes (no HTML in managed content).
 */
export function LegalBlocks({ blocks }: { blocks: ManagedLegalBlock[] }) {
  return (
    <>
      {blocks.map((block) => (
        <React.Fragment key={block.key}>
          <h2>{block.heading}</h2>
          {parseLegalBody(block.body).map((chunk, index) =>
            chunk.type === 'list' ? (
              <ul key={`${block.key}-${index}`}>
                {chunk.items.map((item, itemIndex) => (
                  <li key={`${block.key}-${index}-${itemIndex}`}>
                    {renderSegments(item, `${block.key}-${index}-${itemIndex}`)}
                  </li>
                ))}
              </ul>
            ) : (
              <p key={`${block.key}-${index}`}>
                {renderSegments(chunk.segments, `${block.key}-${index}`)}
              </p>
            ),
          )}
        </React.Fragment>
      ))}
    </>
  );
}
