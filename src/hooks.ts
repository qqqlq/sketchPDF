import { useLayoutEffect, useRef } from 'react'

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 子要素(selector)の縦位置が変わったら、元の位置から滑らかに動かす(FLIP)。
 * resetKey が変わった更新(ズームなど全体が一斉に動くもの)では動かさず、位置だけ記録し直す。
 */
export function useFlip(root: HTMLElement | null, selector: string, sig: unknown, resetKey: unknown) {
  const prev = useRef<{ key: unknown; tops: Map<string, number> }>({ key: resetKey, tops: new Map() })
  useLayoutEffect(() => {
    if (!root) return
    const tops = new Map<string, number>()
    const animate = prev.current.key === resetKey && !reduced()
    root.querySelectorAll<HTMLElement>(selector).forEach(el => {
      const id = el.dataset.pid!, top = el.offsetTop
      tops.set(id, top)
      const old = prev.current.tops.get(id)
      if (animate && old !== undefined && Math.abs(old - top) > 1) {
        el.animate([{ transform: `translateY(${old - top}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' })
      }
    })
    prev.current = { key: resetKey, tops }
  }, [root, selector, sig, resetKey])
}
