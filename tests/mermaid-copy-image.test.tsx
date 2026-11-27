import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SVG =
  '<svg viewBox="0 0 200 100" width="100%" style="max-width: 200px"><foreignObject><div>a<br>b</div></foreignObject></svg>'

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: SVG }))
  }
}))

const copySvgAsPng = vi.fn()
const downloadSvgAsPng = vi.fn()
vi.mock('../src/renderer/src/components/mermaidImage', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('../src/renderer/src/components/mermaidImage')
    >()
  return {
    ...actual,
    copySvgAsPng: (...args: unknown[]) => copySvgAsPng(...args),
    downloadSvgAsPng: (...args: unknown[]) => downloadSvgAsPng(...args)
  }
})

import { MermaidDiagram } from '../src/renderer/src/components/MermaidDiagram'
import { prepareSvgForRaster } from '../src/renderer/src/components/mermaidImage'

const openLightbox = async (): Promise<void> => {
  const diagram = await screen.findByRole('button', { name: 'Expand diagram' })
  fireEvent.click(diagram)
}

describe('mermaid lightbox copy image', () => {
  beforeEach(() => {
    copySvgAsPng.mockReset()
    downloadSvgAsPng.mockReset()
  })

  it('copies without closing the lightbox and shows feedback', async () => {
    copySvgAsPng.mockResolvedValue(undefined)
    render(<MermaidDiagram source="graph TD; A-->B" theme="light" />)
    await openLightbox()

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy diagram as image' })
    )

    expect(copySvgAsPng).toHaveBeenCalledTimes(1)
    expect(copySvgAsPng.mock.calls[0][0]).toBe(SVG)
    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows a failure state when copying rejects', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    copySvgAsPng.mockRejectedValue(new Error('nope'))
    render(<MermaidDiagram source="graph TD; A-->B" theme="light" />)
    await openLightbox()

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy diagram as image' })
    )

    await waitFor(() =>
      expect(screen.getByText('Copy failed')).toBeInTheDocument()
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    errorSpy.mockRestore()
  })

  it('downloads without closing the lightbox and shows feedback', async () => {
    downloadSvgAsPng.mockResolvedValue(undefined)
    render(<MermaidDiagram source="graph TD; A-->B" theme="light" />)
    await openLightbox()

    fireEvent.click(
      screen.getByRole('button', { name: 'Download diagram as PNG' })
    )

    expect(downloadSvgAsPng).toHaveBeenCalledTimes(1)
    expect(downloadSvgAsPng.mock.calls[0][0]).toBe(SVG)
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows a failure state when download rejects', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    downloadSvgAsPng.mockRejectedValue(new Error('nope'))
    render(<MermaidDiagram source="graph TD; A-->B" theme="light" />)
    await openLightbox()

    fireEvent.click(
      screen.getByRole('button', { name: 'Download diagram as PNG' })
    )

    await waitFor(() =>
      expect(screen.getByText('Download failed')).toBeInTheDocument()
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    errorSpy.mockRestore()
  })

  it('still closes via the close button', async () => {
    render(<MermaidDiagram source="graph TD; A-->B" theme="light" />)
    await openLightbox()
    fireEvent.click(
      screen.getByRole('button', { name: 'Close expanded diagram' })
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('prepareSvgForRaster', () => {
  it('produces well-formed XML with explicit dimensions', () => {
    const { xml, width, height } = prepareSvgForRaster(SVG)
    expect(width).toBe(200)
    expect(height).toBe(100)

    const parsed = new DOMParser().parseFromString(xml, 'image/svg+xml')
    expect(parsed.querySelector('parsererror')).toBeNull()
    const root = parsed.documentElement
    expect(root.getAttribute('width')).toBe('200')
    expect(root.getAttribute('height')).toBe('100')
    expect(root.hasAttribute('style')).toBe(false)
  })

  it('throws when the viewBox is missing', () => {
    expect(() => prepareSvgForRaster('<svg></svg>')).toThrow()
  })
})

describe('prepareSvgForRaster with literal namespaces', () => {
  it('does not duplicate xmlns attributes', () => {
    const { xml } = prepareSvgForRaster(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x<br></div></foreignObject></svg>'
    )
    const parsed = new DOMParser().parseFromString(xml, 'image/svg+xml')
    expect(parsed.querySelector('parsererror')).toBeNull()
  })
})
