import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import './App.css'

type NodeType = 'file' | 'directory'

type ScanNode = {
  name: string
  path: string
  type: NodeType
  sizeBytes: number
  modifiedAt: string
  CreationTime?: string
  LastAccessTime?: string
  LastWriteTime?: string
  children?: ScanNode[]
}

type ScanInput = {
  rootPath: string
  generatedAt: string
  node: ScanNode
}

type RecommendationItem = {
  path: string
  type: NodeType
  sizeBytes: number
  modifiedAt: string
  CreationTime: string
  LastAccessTime: string
  LastWriteTime: string
}

type Row = {
  node: ScanNode
  depth: number
}

type SelectionState = 'none' | 'partial' | 'all'

const MB = 1024 * 1024
const MAX_STALE_DAYS = 365

const roundDownToLeadingMagnitude = (value: number): number => {
  if (value <= 0) {
    return 0
  }

  const magnitude = 10 ** Math.floor(Math.log10(value))
  return Math.floor(value / magnitude) * magnitude
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`
}

const ageInDays = (dateIso: string): number => {
  const modified = new Date(dateIso).getTime()
  if (Number.isNaN(modified)) {
    return 0
  }
  const now = Date.now()
  return Math.max(0, Math.floor((now - modified) / (1000 * 60 * 60 * 24)))
}

const getNodeLastWriteTime = (node: ScanNode): string => node.LastWriteTime ?? node.modifiedAt
const getNodeCreationTime = (node: ScanNode): string => node.CreationTime ?? node.modifiedAt
const getNodeLastAccessTime = (node: ScanNode): string => node.LastAccessTime ?? node.modifiedAt

const formatDisplayDate = (dateIso: string): string => {
  const date = new Date(dateIso)
  if (Number.isNaN(date.getTime())) {
    return 'Invalid date'
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const getExportFileName = (): string => {
  const date = new Date()
  const year = String(date.getFullYear()).slice(-2)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `output-${year}${month}${day}.json`
}

const flattenVisibleRows = (
  node: ScanNode,
  expandedPaths: Set<string>,
  depth = 0,
): Row[] => {
  const rows: Row[] = [{ node, depth }]
  const canExpand = node.type === 'directory' && (node.children?.length ?? 0) > 0
  if (!canExpand || !expandedPaths.has(node.path)) {
    return rows
  }

  for (const child of node.children ?? []) {
    rows.push(...flattenVisibleRows(child, expandedPaths, depth + 1))
  }

  return rows
}

const collectAllPaths = (node: ScanNode, output = new Set<string>()): Set<string> => {
  output.add(node.path)
  for (const child of node.children ?? []) {
    collectAllPaths(child, output)
  }
  return output
}

const findNodeByPath = (node: ScanNode, targetPath: string): ScanNode | null => {
  if (node.path === targetPath) {
    return node
  }

  for (const child of node.children ?? []) {
    const found = findNodeByPath(child, targetPath)
    if (found) {
      return found
    }
  }

  return null
}

const collectSubtreePaths = (node: ScanNode, output = new Set<string>()): Set<string> => {
  output.add(node.path)
  for (const child of node.children ?? []) {
    collectSubtreePaths(child, output)
  }
  return output
}

const countNodes = (node: ScanNode): number => {
  let total = 1
  for (const child of node.children ?? []) {
    total += countNodes(child)
  }
  return total
}

const getMaxNodeMetrics = (
  node: ScanNode,
): {
  maxSizeBytes: number
  maxAgeDays: number
} => {
  let maxSizeBytes = node.sizeBytes
  let maxAgeDays = ageInDays(getNodeLastWriteTime(node))

  for (const child of node.children ?? []) {
    const childMetrics = getMaxNodeMetrics(child)
    maxSizeBytes = Math.max(maxSizeBytes, childMetrics.maxSizeBytes)
    maxAgeDays = Math.max(maxAgeDays, childMetrics.maxAgeDays)
  }

  return { maxSizeBytes, maxAgeDays }
}

const getMaxDescendantSizeBytes = (node: ScanNode): number => {
  let maxSizeBytes = 0

  for (const child of node.children ?? []) {
    maxSizeBytes = Math.max(maxSizeBytes, child.sizeBytes, getMaxDescendantSizeBytes(child))
  }

  return maxSizeBytes
}

const validateInput = (payload: unknown): payload is ScanInput => {
  if (!payload || typeof payload !== 'object') {
    return false
  }
  const candidate = payload as Partial<ScanInput>
  return (
    typeof candidate.rootPath === 'string' &&
    typeof candidate.generatedAt === 'string' &&
    !!candidate.node
  )
}

function App() {
  const [scanInput, setScanInput] = useState<ScanInput | null>(null)
  const [error, setError] = useState<string>('')
  const [staleDays, setStaleDays] = useState(180)
  const [minSizeMb, setMinSizeMb] = useState(1024)
  const [sortBy, setSortBy] = useState<'size' | 'name' | 'created' | 'accessed' | 'written'>(
    'size',
  )
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set<string>())
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set<string>())
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadInput = (payload: unknown) => {
    if (!validateInput(payload)) {
      setError('Invalid JSON format. Expected: rootPath, generatedAt, node.')
      return
    }
    const typed = payload as ScanInput
    const { maxAgeDays } = getMaxNodeMetrics(typed.node)
    const maxSizeBytes = getMaxDescendantSizeBytes(typed.node)
    const suggestedMinSizeMb = roundDownToLeadingMagnitude((maxSizeBytes / MB) * 0.75)
    const suggestedStaleDays = Math.round(maxAgeDays * 0.75)
    const rootExpanded = new Set<string>([typed.node.path])
    setScanInput(typed)
    setMinSizeMb(Math.max(0, suggestedMinSizeMb))
    setStaleDays(Math.min(MAX_STALE_DAYS, Math.max(0, suggestedStaleDays)))
    setExpandedPaths(rootExpanded)
    setSelectedPaths(new Set<string>())
    setError('')
  }

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    try {
      const text = await file.text()
      const normalized = text.replace(/^\uFEFF/, '')
      const parsed = JSON.parse(normalized) as unknown
      loadInput(parsed)
    } catch {
      setError('Could not parse JSON file. Check that it is valid UTF-8 JSON.')
    } finally {
      // Reset so selecting the same file again still triggers onChange.
      event.target.value = ''
    }
  }

  const handleLoadSample = async () => {
    try {
      const response = await fetch('/sample-input.json')
      if (!response.ok) {
        throw new Error('Sample fetch failed')
      }
      const parsed = (await response.json()) as unknown
      loadInput(parsed)
    } catch {
      setError('Unable to load sample-input.json from /public.')
    }
  }

  const sortedRoot = useMemo<ScanNode | null>(() => {
    if (!scanInput) {
      return null
    }

    const sortChildren = (node: ScanNode): ScanNode => {
      if (node.type !== 'directory') {
        return node
      }

      const children = [...(node.children ?? [])].map(sortChildren)
      children.sort((a, b) => {
        let compare = 0
        if (sortBy === 'name') {
          compare = a.name.localeCompare(b.name)
        } else if (sortBy === 'size') {
          compare = a.sizeBytes - b.sizeBytes
        } else if (sortBy === 'created') {
          compare =
            new Date(getNodeCreationTime(a)).getTime() - new Date(getNodeCreationTime(b)).getTime()
        } else if (sortBy === 'accessed') {
          compare =
            new Date(getNodeLastAccessTime(a)).getTime() -
            new Date(getNodeLastAccessTime(b)).getTime()
        } else {
          compare =
            new Date(getNodeLastWriteTime(a)).getTime() -
            new Date(getNodeLastWriteTime(b)).getTime()
        }
        return sortDirection === 'asc' ? compare : -compare
      })

      return { ...node, children }
    }

    return sortChildren(scanInput.node)
  }, [scanInput, sortBy, sortDirection])

  const visibleRows = useMemo(() => {
    if (!sortedRoot) {
      return [] as Row[]
    }

    return flattenVisibleRows(sortedRoot, expandedPaths)
  }, [sortedRoot, expandedPaths])

  const totalNodeCount = useMemo(() => {
    if (!scanInput) {
      return 0
    }
    return countNodes(scanInput.node)
  }, [scanInput])

  const selectionStateMap = useMemo(() => {
    const stateMap = new Map<string, SelectionState>()
    if (!sortedRoot) {
      return stateMap
    }

    const walk = (node: ScanNode): { selected: number; total: number } => {
      let selected = selectedPaths.has(node.path) ? 1 : 0
      let total = 1

      for (const child of node.children ?? []) {
        const childCounts = walk(child)
        selected += childCounts.selected
        total += childCounts.total
      }

      let state: SelectionState = 'none'
      if (selected === 0) {
        state = 'none'
      } else if (selected === total) {
        state = 'all'
      } else {
        state = 'partial'
      }

      stateMap.set(node.path, state)
      return { selected, total }
    }

    walk(sortedRoot)
    return stateMap
  }, [sortedRoot, selectedPaths])

  const recommendedItems = useMemo<RecommendationItem[]>(() => {
    if (!sortedRoot) {
      return []
    }

    const selected: RecommendationItem[] = []

    const pushRecommendation = (node: ScanNode) => {
      const lastWriteTime = getNodeLastWriteTime(node)
      selected.push({
        path: node.path,
        type: node.type,
        sizeBytes: node.sizeBytes,
        modifiedAt: lastWriteTime,
        CreationTime: getNodeCreationTime(node),
        LastAccessTime: getNodeLastAccessTime(node),
        LastWriteTime: lastWriteTime,
      })
    }

    const collectForExport = (node: ScanNode) => {
      const selectionState = selectionStateMap.get(node.path) ?? 'none'

      if (node.type === 'directory' && selectionState === 'all') {
        pushRecommendation(node)
        return
      }

      if (node.type === 'file' && selectionState === 'all') {
        pushRecommendation(node)
        return
      }

      for (const child of node.children ?? []) {
        collectForExport(child)
      }
    }

    collectForExport(sortedRoot)
    return selected
  }, [sortedRoot, selectionStateMap])

  const exportSelection = () => {
    if (!scanInput || recommendedItems.length === 0) {
      return
    }

    const output = {
      generatedAt: new Date().toISOString(),
      sourceGeneratedAt: scanInput.generatedAt,
      rootPath: scanInput.rootPath,
      items: recommendedItems,
    }

    const blob = new Blob([JSON.stringify(output, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = getExportFileName()
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const toggleExpanded = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const toggleSelected = (path: string) => {
    if (!sortedRoot) {
      return
    }

    const targetNode = findNodeByPath(sortedRoot, path)
    if (!targetNode) {
      return
    }

    const subtreePaths = collectSubtreePaths(targetNode)

    setSelectedPaths((current) => {
      const next = new Set(current)

      const currentState = selectionStateMap.get(path) ?? 'none'
      const shouldSelect = currentState !== 'all'
      for (const subtreePath of subtreePaths) {
        if (shouldSelect) {
          next.add(subtreePath)
        } else {
          next.delete(subtreePath)
        }
      }

      return next
    })
  }

  const expandAll = () => {
    if (!sortedRoot) {
      return
    }
    setExpandedPaths(collectAllPaths(sortedRoot))
  }

  const collapseAll = () => {
    if (!sortedRoot) {
      return
    }
    setExpandedPaths(new Set([sortedRoot.path]))
  }

  const handleSortClick = (column: 'name' | 'size' | 'created' | 'accessed' | 'written') => {
    if (sortBy === column) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortBy(column)
    setSortDirection(column === 'name' ? 'asc' : 'desc')
  }

  const getSortMarker = (column: 'name' | 'size' | 'created' | 'accessed' | 'written') => {
    if (sortBy !== column) {
      return '↕'
    }
    return sortDirection === 'asc' ? '▲' : '▼'
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">ByteSift</p>
        <h1>Find large and stale data before your disk does.</h1>
        <p className="subtitle">
          Load a JSON scan report, explore the tree by size and age, and export a focused
          cleanup plan for archive or deletion scripts.
        </p>
        <div className="hero-actions">
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            Load JSON
          </button>
          <button type="button" onClick={handleLoadSample} className="secondary">
            Load Sample
          </button>
          <input
            type="file"
            ref={fileInputRef}
            accept="application/json"
            onChange={handleFileUpload}
            hidden
          />
        </div>
        {scanInput ? (
          <p className="load-meta">
            Loaded {totalNodeCount} nodes from {scanInput.rootPath}
          </p>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
      </header>

      <section className="controls">
        <label>
          <span className="control-label-text">
            Min Size (MB)
            <span className="control-label-marker control-label-marker-large" aria-hidden="true" />
          </span>
          <input
            type="number"
            value={minSizeMb}
            min={0}
            onChange={(event) => {
              const value = Number(event.target.value)
              setMinSizeMb(Number.isFinite(value) && value >= 0 ? value : 0)
            }}
          />
        </label>
        <label>
          <span className="control-label-text">
            Stale (Days)
            <span className="control-label-marker control-label-marker-stale" aria-hidden="true" />
          </span>
          <input
            type="number"
            value={staleDays}
            min={0}
            max={MAX_STALE_DAYS}
            onChange={(event) => {
              const value = Number(event.target.value)
              const normalized = Number.isFinite(value) && value >= 0 ? value : 0
              setStaleDays(Math.min(MAX_STALE_DAYS, normalized))
            }}
          />
        </label>
      </section>

      <section className="toolbar">
        <button type="button" onClick={expandAll} className="secondary">
          Expand All
        </button>
        <button type="button" onClick={collapseAll} className="secondary">
          Collapse All
        </button>
        <button type="button" onClick={exportSelection} disabled={recommendedItems.length === 0}>
          Export output.json ({recommendedItems.length})
        </button>
      </section>

      <section className="summary-cards">
        <article>
          <h3>Visible Nodes</h3>
          <p>{visibleRows.length}</p>
        </article>
        <article>
          <h3>Total Nodes</h3>
          <p>{totalNodeCount}</p>
        </article>
        <article>
          <h3>Selected</h3>
          <p>{recommendedItems.length}</p>
        </article>
        <article>
          <h3>Selected Size</h3>
          <p>{formatBytes(recommendedItems.reduce((sum, item) => sum + item.sizeBytes, 0))}</p>
        </article>
        <article>
          <h3>Visible Size</h3>
          <p>{formatBytes(visibleRows.reduce((sum, { node }) => sum + node.sizeBytes, 0))}</p>
        </article>
      </section>

      <section className="tree-panel">
        <div className="tree-header">
          <span aria-hidden="true" className="marker-header" />
          <button type="button" className="sort-header" onClick={() => handleSortClick('name')}>
            Name <span>{getSortMarker('name')}</span>
          </button>
          <button type="button" className="sort-header" onClick={() => handleSortClick('size')}>
            Size <span>{getSortMarker('size')}</span>
          </button>
          <button type="button" className="sort-header" onClick={() => handleSortClick('created')}>
            Created <span>{getSortMarker('created')}</span>
          </button>
          <button
            type="button"
            className="sort-header"
            onClick={() => handleSortClick('accessed')}
          >
            Accessed <span>{getSortMarker('accessed')}</span>
          </button>
          <button type="button" className="sort-header" onClick={() => handleSortClick('written')}>
            Last Write <span>{getSortMarker('written')}</span>
          </button>
          <span>Age</span>
        </div>
        <div className="tree-body">
          {visibleRows.length === 0 ? (
            <p className="empty">
              {scanInput
                ? 'No nodes are visible at this level. Try expanding directories.'
                : 'Load data to see nodes.'}
            </p>
          ) : (
            visibleRows.map(({ node, depth }) => {
              const childrenCount = node.children?.length ?? 0
              const isExpandable = node.type === 'directory' && childrenCount > 0
              const isExpanded = expandedPaths.has(node.path)
              const lastWriteTime = getNodeLastWriteTime(node)
              const stale = ageInDays(lastWriteTime) >= staleDays
              const large = node.sizeBytes >= minSizeMb * MB
              const selectionState = selectionStateMap.get(node.path) ?? 'none'
              const selected = selectionState === 'all'
              const partial = selectionState === 'partial'

              return (
                <div className="tree-row" key={node.path}>
                  <span className="marker-stack" aria-hidden="true">
                    <span className={`marker-cell marker-large ${large ? 'active' : ''}`} />
                    <span className={`marker-cell marker-stale ${stale ? 'active' : ''}`} />
                  </span>
                  <div className="name-cell" style={{ paddingLeft: `${depth * 1.15}rem` }}>
                    <input
                      type="checkbox"
                      className={`node-checkbox ${partial ? 'partial' : ''}`}
                      checked={selected}
                      onChange={() => toggleSelected(node.path)}
                      ref={(element) => {
                        if (element) {
                          element.indeterminate = partial
                        }
                      }}
                      aria-label={`Select ${node.path}`}
                    />
                    {isExpandable ? (
                      <button
                        type="button"
                        className="toggle"
                        onClick={() => toggleExpanded(node.path)}
                        aria-label={`Toggle ${node.path}`}
                      >
                        {isExpanded ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span className="toggle-placeholder" />
                    )}
                    <span className="name-text">{node.name}</span>
                  </div>
                  <span>{formatBytes(node.sizeBytes)}</span>
                  <span>{formatDisplayDate(getNodeCreationTime(node))}</span>
                  <span>{formatDisplayDate(getNodeLastAccessTime(node))}</span>
                  <span>{formatDisplayDate(lastWriteTime)}</span>
                  <span>{ageInDays(lastWriteTime)} days</span>
                </div>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}

export default App
