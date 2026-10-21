import type { IconDrawing } from '../rpg/dnd35/icons'

/** A LORE. icon (docs/iconography.md): the same 1.5 px line at every size, the simpler drawing at 16 px and below. */
export function Mark({ drawing, size = 24, className }: { drawing: IconDrawing; size?: number; className?: string }) {
  const markup = size <= 16 && drawing.s ? drawing.s : drawing.d
  // The drawings are constants of the app, never user text.
  return (
    <svg className={className ? `mark ${className}` : 'mark'} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markup }} />
  )
}
