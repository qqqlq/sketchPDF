import { PDFDocument, rgb, degrees, LineCapStyle, type PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { arrowGeom, FM, LH, PAD, penPath, total, vsize } from './geom'
import { assets, sources } from './docs'
import type { Page } from './types'

const fontBytes: Record<string, ArrayBuffer> = {}
async function loadFontBytes(bold: boolean) {
  const k = bold ? 'Bold' : 'Regular'
  return fontBytes[k] ||= await (await fetch(`fonts/BIZUDPGothic-${k}.ttf`)).arrayBuffer()
}

const hex = (h: string) => {
  const n = parseInt(h.slice(1), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

export async function exportPdf(pages: Page[]) {
  const out = await PDFDocument.create()
  out.registerFontkit(fontkit)
  const libDocs = new Map<number, PDFDocument>(), fonts: Record<string, PDFFont> = {}, imgs = new Map<string, Awaited<ReturnType<typeof out.embedPng>>>()
  const getFont = async (bold: boolean) => fonts[String(bold)] ||= await out.embedFont(await loadFontBytes(bold), { subset: false })

  for (const p of pages) {
    const { w: vw, h: vh } = vsize(p)
    const page = out.addPage([vw, vh])
    if (p.src >= 0) {
      if (!libDocs.has(p.src)) libDocs.set(p.src, await PDFDocument.load(sources[p.src].bytes, { ignoreEncryption: true }))
      const sp = libDocs.get(p.src)!.getPage(p.num - 1)
      const [l, b, r, t] = p.box!
      const emb = await out.embedPage(sp, { left: l, bottom: b, right: r, top: t })
      const tr = total(p) as 0 | 90 | 180 | 270
      const pos = { 0: [0, 0], 90: [0, p.w0], 180: [p.w0, p.h0], 270: [p.h0, 0] }[tr]
      const rot = { 0: 0, 90: -90, 180: 180, 270: 90 }[tr]
      page.drawPage(emb, { x: pos[0], y: pos[1], rotate: degrees(rot) })
    }
    for (const o of p.objs) {
      const Y = (y: number) => vh - y
      const stroke = 'sw' in o && o.sw > 0 && 'stroke' in o ? hex(o.stroke || '#000000') : undefined
      switch (o.type) {
        case 'text': {
          const font = await getFont(!!o.bold)
          const cs = new Set(font.getCharacterSet())
          const lines = o.text.split('\n').map(l => [...l].filter(c => cs.has(c.codePointAt(0)!)).join(''))
          const fs = o.fs, lh = fs * LH
          const widths = lines.map(l => font.widthOfTextAtSize(l, fs))
          const bw = Math.max(0, ...widths) + PAD * 2, bh = lines.length * lh + PAD * 2
          if (o.bg) page.drawRectangle({ x: o.x, y: Y(o.y + bh), width: bw, height: bh, color: hex(o.bg), opacity: o.op })
          lines.forEach((l, i) => {
            if (!l) return
            const off = o.align === 'center' ? (bw - PAD * 2 - widths[i]) / 2 : o.align === 'right' ? bw - PAD * 2 - widths[i] : 0
            const base = o.y + PAD + i * lh + (lh - (FM.asc + FM.desc) * fs) / 2 + FM.asc * fs
            page.drawText(l, { x: o.x + PAD + off, y: Y(base), size: fs, font, color: hex(o.color), opacity: o.op })
          })
          break
        }
        case 'image': {
          const a = assets.get(o.asset)!
          if (!imgs.has(o.asset)) imgs.set(o.asset, a.mime === 'image/png' ? await out.embedPng(a.bytes) : await out.embedJpg(a.bytes))
          page.drawImage(imgs.get(o.asset)!, { x: o.x, y: Y(o.y + o.h), width: o.w, height: o.h, opacity: o.op })
          break
        }
        case 'rect': case 'hl':
          if (!o.fill && !stroke) break
          page.drawRectangle({ x: o.x, y: Y(o.y + o.h), width: o.w, height: o.h, color: o.fill ? hex(o.fill) : undefined, opacity: o.op, borderColor: stroke, borderWidth: stroke ? o.sw : 0, borderOpacity: o.op })
          break
        case 'ellipse':
          if (!o.fill && !stroke) break
          page.drawEllipse({ x: o.x + o.w / 2, y: Y(o.y + o.h / 2), xScale: o.w / 2, yScale: o.h / 2, color: o.fill ? hex(o.fill) : undefined, opacity: o.op, borderColor: stroke, borderWidth: stroke ? o.sw : 0, borderOpacity: o.op })
          break
        case 'line': case 'arrow': {
          let [x2, y2] = [o.x2, o.y2]
          const g = o.type === 'arrow' ? arrowGeom(o) : null
          if (g) [x2, y2] = g.end
          page.drawLine({ start: { x: o.x1, y: Y(o.y1) }, end: { x: x2, y: Y(y2) }, thickness: o.sw, color: hex(o.stroke), opacity: o.op, lineCap: LineCapStyle.Round })
          if (g) page.drawSvgPath(`M ${g.head[0].join(' ')} L ${g.head[1].join(' ')} L ${g.head[2].join(' ')} Z`, { x: 0, y: vh, color: hex(o.stroke), opacity: o.op })
          break
        }
        case 'pen':
          page.drawSvgPath(penPath(o.pts), { x: 0, y: vh, borderColor: hex(o.stroke), borderWidth: o.sw, borderOpacity: o.op, borderLineCap: LineCapStyle.Round })
          break
      }
    }
  }
  return out.save()
}
