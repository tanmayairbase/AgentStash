const EXPORT_SCALE = 2
// Chromium returns a null blob when a canvas exceeds roughly 16k px per side or
// 268M px total; stay well under both.
const MAX_CANVAS_SIDE = 8192
// Margin around the diagram in CSS px, so content doesn't touch the PNG edge.
const EXPORT_PADDING = 24

export type PreparedSvg = { xml: string; width: number; height: number }

// mermaid returns HTML-serialized markup (e.g. unclosed <br> inside
// <foreignObject> labels), which is not valid XML and would fail to load as an
// image. Parsing as HTML and re-serializing as XML normalizes it. Mermaid also
// emits width="100%" with a max-width style and no height, so explicit pixel
// dimensions are taken from the viewBox.
export const prepareSvgForRaster = (svgMarkup: string): PreparedSvg => {
  const doc = new DOMParser().parseFromString(svgMarkup, 'text/html')
  const svg = doc.querySelector('svg')
  if (!svg) {
    throw new Error('No <svg> element found in diagram markup')
  }

  const viewBox = svg
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (
    !viewBox ||
    viewBox.length !== 4 ||
    !(viewBox[2] > 0) ||
    !(viewBox[3] > 0)
  ) {
    throw new Error('Diagram SVG has no usable viewBox')
  }
  const [, , width, height] = viewBox

  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.removeAttribute('style')
  // The HTML parser already assigns the SVG/XHTML namespaces; XMLSerializer
  // emits them itself, so literal xmlns attributes would be duplicated.
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const name of element.getAttributeNames()) {
      if (name === 'xmlns' || name.startsWith('xmlns:')) {
        element.removeAttribute(name)
      }
    }
  }

  return { xml: new XMLSerializer().serializeToString(svg), width, height }
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () =>
      reject(new Error('Failed to load diagram SVG as image'))
    image.src = src
  })

const toBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

export const svgToPngBlob = async (
  svgMarkup: string,
  background: string
): Promise<Blob> => {
  const { xml, width, height } = prepareSvgForRaster(svgMarkup)

  // A data URL (not a blob URL) keeps the canvas untainted when the SVG
  // contains <foreignObject>.
  const image = await loadImage(`data:image/svg+xml;base64,${toBase64(xml)}`)

  const scale = Math.min(
    EXPORT_SCALE,
    MAX_CANVAS_SIDE / (width + EXPORT_PADDING * 2),
    MAX_CANVAS_SIDE / (height + EXPORT_PADDING * 2)
  )
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round((width + EXPORT_PADDING * 2) * scale))
  canvas.height = Math.max(1, Math.round((height + EXPORT_PADDING * 2) * scale))

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D context unavailable')
  }
  context.fillStyle = background
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(
    image,
    EXPORT_PADDING * scale,
    EXPORT_PADDING * scale,
    width * scale,
    height * scale
  )

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('Canvas produced no PNG data'))
      }
    }, 'image/png')
  })
}

// Must be called synchronously from a user gesture: the ClipboardItem takes a
// promise so the async rasterization doesn't outlive transient activation.
export const copySvgAsPng = (
  svgMarkup: string,
  background: string
): Promise<void> =>
  navigator.clipboard.write([
    new ClipboardItem({ 'image/png': svgToPngBlob(svgMarkup, background) })
  ])

export const downloadSvgAsPng = async (
  svgMarkup: string,
  background: string
): Promise<void> => {
  const blob = await svgToPngBlob(svgMarkup, background)
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = `diagram-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
    document.body.appendChild(link)
    link.click()
    link.remove()
  } finally {
    // Revoke after the click has been dispatched so the download can start.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
