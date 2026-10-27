import { chooseTool } from '../interaction'
import { TOOLS } from '../tools'
import { useStore } from '../store'

export function Tools() {
  const tool = useStore(s => s.tool)
  return (
    <nav id="tools">
      {TOOLS.map(([id, label, key, path]) => (
        <button key={id} className={'tool' + (tool === id ? ' on' : '')} title={`${label} (${key})`} onClick={() => chooseTool(id)}>
          <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: path }} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
