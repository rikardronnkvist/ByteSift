import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from '../src/App'

const createSampleInput = () => {
  const now = Date.now()
  const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()
  const fourHundredDaysAgo = new Date(now - 400 * 24 * 60 * 60 * 1000).toISOString()
  const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString()

  return {
    rootPath: '/root',
    generatedAt: new Date(now).toISOString(),
    node: {
      name: 'root',
      path: '/root',
      type: 'directory' as const,
      sizeBytes: 3 * 1024 * 1024 * 1024,
      modifiedAt: oneDayAgo,
      CreationTime: oneDayAgo,
      LastAccessTime: oneDayAgo,
      LastWriteTime: oneDayAgo,
      children: [
        {
          name: 'old-data.bin',
          path: '/root/old-data.bin',
          type: 'file' as const,
          sizeBytes: 2 * 1024 * 1024 * 1024,
          modifiedAt: fourHundredDaysAgo,
          CreationTime: tenDaysAgo,
          LastAccessTime: tenDaysAgo,
          LastWriteTime: fourHundredDaysAgo,
        },
      ],
    },
  }
}

const uploadScan = async (container: HTMLElement) => {
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null
  expect(fileInput).not.toBeNull()
  if (!fileInput) {
    return
  }

  const file = new File([JSON.stringify(createSampleInput())], 'scan.json', {
    type: 'application/json',
  })
  fireEvent.change(fileInput, { target: { files: [file] } })

  await waitFor(() => {
    expect(screen.getByText(/loaded 2 nodes from/i)).toBeInTheDocument()
  })
}

describe('App', () => {
  it('renders primary controls', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: /load json/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export json/i })).toBeDisabled()
    expect(screen.getByLabelText(/select date attribute for stale calculation/i)).toBeInTheDocument()
  })

  it('shows stale attribute options', () => {
    render(<App />)

    const select = screen.getByLabelText(/select date attribute for stale calculation/i)
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Last Write' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Created' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Last Access' })).toBeInTheDocument()
  })

  it('shows stale marker tooltip for folders containing old descendants', async () => {
    const { container } = render(<App />)
    await uploadScan(container)

    expect(screen.getByTitle('Stale - Contains old files or folders')).toBeInTheDocument()
    expect(screen.getByTitle(/Stale - Older than \d+ days/)).toBeInTheDocument()
    expect(screen.getAllByTitle(/Large - Over/).length).toBeGreaterThan(0)
  })

  it('supports stale attribute switching', async () => {
    const { container } = render(<App />)
    await uploadScan(container)

    const select = screen.getByLabelText(/select date attribute for stale calculation/i)
    fireEvent.change(select, { target: { value: 'created' } })
    fireEvent.change(select, { target: { value: 'lastAccess' } })
    fireEvent.change(select, { target: { value: 'lastWrite' } })

    expect(screen.getByRole('option', { name: 'Last Write' })).toBeInTheDocument()
  })

  it('toggles sort direction when clicking same column repeatedly', async () => {
    const { container } = render(<App />)
    await uploadScan(container)

    const nameSortButton = screen.getByRole('button', { name: /name/i })
    expect(nameSortButton.textContent).toContain('↕')

    fireEvent.click(nameSortButton)
    expect(nameSortButton.textContent).toContain('▲')

    fireEvent.click(nameSortButton)
    expect(nameSortButton.textContent).toContain('▼')
  })

  it('supports expand/collapse and selection toggling', async () => {
    const { container } = render(<App />)
    await uploadScan(container)

    expect(screen.getByText('old-data.bin')).toBeInTheDocument()

    const toggleRoot = screen.getByRole('button', { name: 'Toggle /root' })
    fireEvent.click(toggleRoot)
    expect(screen.queryByText('old-data.bin')).not.toBeInTheDocument()

    fireEvent.click(toggleRoot)
    expect(screen.getByText('old-data.bin')).toBeInTheDocument()

    const rootCheckbox = screen.getByLabelText('Select /root')
    const exportButton = screen.getByRole('button', { name: /export json/i })
    expect(exportButton).toBeDisabled()

    fireEvent.click(rootCheckbox)
    expect(exportButton).not.toBeDisabled()

    fireEvent.click(rootCheckbox)
    expect(exportButton).toBeDisabled()
  })

  it('loads sample data and supports all sort headers', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => createSampleInput() } as Response)

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /load sample/i }))

    await waitFor(() => {
      expect(screen.getByText(/loaded 2 nodes from/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /size/i }))
    fireEvent.click(screen.getByRole('button', { name: /created/i }))
    fireEvent.click(screen.getByRole('button', { name: /accessed/i }))
    fireEvent.click(screen.getByRole('button', { name: /last write/i }))
    fireEvent.click(screen.getByRole('button', { name: /age/i }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockRestore()
  })

  it('shows an error when sample loading fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response)

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /load sample/i }))

    await waitFor(() => {
      expect(screen.getByText(/unable to load sample-input\.json from \/public\./i)).toBeInTheDocument()
    })

    fetchMock.mockRestore()
  })
})
