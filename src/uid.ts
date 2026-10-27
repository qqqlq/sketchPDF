let seq = 0
export const nid = () => 'i' + (++seq) + Math.random().toString(36).slice(2, 6)
