import type { ToolId } from './types'

/** [id, ラベル, ショートカットキー, アイコンのSVGパス] */
export const TOOLS: [ToolId, string, string, string][] = [
  ['select', '選択', 'V', '<path d="M5 3l14 8-6 2-2 6z"/>'],
  ['text', 'テキスト', 'T', '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'],
  ['image', '画像', 'I', '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 4 4 3-3 4 4"/>'],
  ['rect', '四角', 'R', '<rect x="4" y="6" width="16" height="12" rx="1"/>'],
  ['ellipse', '円', 'O', '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>'],
  ['line', '線', 'L', '<path d="M5 19L19 5"/>'],
  ['arrow', '矢印', 'A', '<path d="M5 19L19 5M10 5h9v9"/>'],
  ['pen', 'ペン', 'P', '<path d="M4 20l1-4L16 5l3 3L8 19z"/>'],
  ['hl', '蛍光ペン', 'H', '<path d="M9 14l6-8 4 3-6 8zM9 14l-3 5 5-1M14 20h6"/>'],
]

export const TYPE_LABEL: Record<string, string> = {
  text: 'テキスト', image: '画像', rect: '四角', ellipse: '円', hl: '蛍光ペン', line: '線', arrow: '矢印', pen: 'ペン',
}
