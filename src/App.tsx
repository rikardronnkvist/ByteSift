import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import './App.css'
import bytesiftLogo from './assets/bytesift.png'

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
type SortColumn = 'size' | 'name' | 'created' | 'accessed' | 'written' | 'age'
type StaleAttribute = 'lastWrite' | 'created' | 'lastAccess'

const MB = 1024 * 1024
const MAX_STALE_DAYS = 365
const IS_DEV = import.meta.env.DEV
const MAX_UPLOAD_SIZE_MB = 1024
const MAX_SCAN_NODE_DEPTH = 128
const MAX_SCAN_NODE_COUNT = 20000
const MAX_CHILDREN_PER_NODE = 2000

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

const getNodeDateForStaleAttribute = (node: ScanNode, staleAttribute: StaleAttribute): string => {
  switch (staleAttribute) {
    case 'created':
      return getNodeCreationTime(node)
    case 'lastAccess':
      return getNodeLastAccessTime(node)
    case 'lastWrite':
    default:
      return getNodeLastWriteTime(node)
  }
}

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

const truncateNodeName = (name: string, type: NodeType, maxLength = 50): string => {
  if (name.length <= maxLength) {
    return name
  }

  const ellipsis = '...'

  if (type !== 'file') {
    return `${name.slice(0, Math.max(0, maxLength - ellipsis.length))}${ellipsis}`
  }

  const lastDot = name.lastIndexOf('.')
  const hasExtension = lastDot > 0 && lastDot < name.length - 1
  if (!hasExtension) {
    return `${name.slice(0, Math.max(0, maxLength - ellipsis.length))}${ellipsis}`
  }

  const extension = name.slice(lastDot)
  const baseName = name.slice(0, lastDot)
  const availableBaseLength = maxLength - extension.length - ellipsis.length

  if (availableBaseLength <= 0) {
    return `${name.slice(0, Math.max(0, maxLength - ellipsis.length))}${ellipsis}`
  }

  return `${baseName.slice(0, availableBaseLength)}${ellipsis}${extension}`
}

const flattenVisibleRows = (
  node: ScanNode,
  expandedPaths: Set<string>,
  depth = 0,
): Row[] => {
  const rows: Row[] = []
  const stack: Row[] = [{ node, depth }]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    rows.push(current)
    const canExpand =
      current.node.type === 'directory' && (current.node.children?.length ?? 0) > 0
    if (!canExpand || !expandedPaths.has(current.node.path)) {
      continue
    }

    const children = current.node.children ?? []
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: current.depth + 1 })
    }
  }

  return rows
}

const findNodeByPath = (node: ScanNode, targetPath: string): ScanNode | null => {
  const stack: ScanNode[] = [node]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    if (current.path === targetPath) {
      return current
    }

    for (const child of current.children ?? []) {
      stack.push(child)
    }
  }

  return null
}

const collectSubtreePaths = (node: ScanNode, output = new Set<string>()): Set<string> => {
  const stack: ScanNode[] = [node]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    output.add(current.path)
    for (const child of current.children ?? []) {
      stack.push(child)
    }
  }

  return output
}

const countNodes = (node: ScanNode): number => {
  let total = 0
  const stack: ScanNode[] = [node]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    total += 1
    for (const child of current.children ?? []) {
      stack.push(child)
    }
  }

  return total
}

const getMaxNodeMetrics = (
  node: ScanNode,
): {
  maxSizeBytes: number
  maxAgeDays: number
} => {
  let maxSizeBytes = 0
  let maxAgeDays = 0
  const stack: ScanNode[] = [node]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    maxSizeBytes = Math.max(maxSizeBytes, current.sizeBytes)
    maxAgeDays = Math.max(maxAgeDays, ageInDays(getNodeLastWriteTime(current)))

    for (const child of current.children ?? []) {
      stack.push(child)
    }
  }

  return { maxSizeBytes, maxAgeDays }
}

const getMaxDescendantSizeBytes = (node: ScanNode): number => {
  let maxSizeBytes = 0

  const stack: ScanNode[] = [...(node.children ?? [])]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    maxSizeBytes = Math.max(maxSizeBytes, current.sizeBytes)
    for (const child of current.children ?? []) {
      stack.push(child)
    }
  }

  return maxSizeBytes
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const validateRequiredNodeFields = (candidate: Partial<ScanNode>): boolean =>
  typeof candidate.name === 'string' &&
  typeof candidate.path === 'string' &&
  (candidate.type === 'file' || candidate.type === 'directory') &&
  typeof candidate.sizeBytes === 'number' &&
  Number.isFinite(candidate.sizeBytes) &&
  typeof candidate.modifiedAt === 'string'

const validateOptionalTimestamps = (candidate: Partial<ScanNode>): boolean => {
  if (candidate.CreationTime !== undefined && typeof candidate.CreationTime !== 'string') {
    return false
  }
  if (candidate.LastAccessTime !== undefined && typeof candidate.LastAccessTime !== 'string') {
    return false
  }
  if (candidate.LastWriteTime !== undefined && typeof candidate.LastWriteTime !== 'string') {
    return false
  }
  return true
}

const validateNodeTree = (node: unknown): node is ScanNode => {
  if (!isRecord(node)) {
    return false
  }

  const stack: Array<{ node: unknown; depth: number }> = [{ node, depth: 0 }]
  let nodeCount = 0

  while (stack.length > 0) {
    const current = stack.pop()!

    if (!isRecord(current.node) || current.depth > MAX_SCAN_NODE_DEPTH) {
      return false
    }

    nodeCount += 1
    if (nodeCount > MAX_SCAN_NODE_COUNT) {
      return false
    }

    const candidate = current.node as Partial<ScanNode>
    if (!validateRequiredNodeFields(candidate) || !validateOptionalTimestamps(candidate)) {
      return false
    }

    const children = candidate.children
    if (children === undefined) {
      continue
    }

    if (!Array.isArray(children) || children.length > MAX_CHILDREN_PER_NODE) {
      return false
    }

    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: current.depth + 1 })
    }
  }

  return true
}

const validateInput = (payload: unknown): payload is ScanInput => {
  if (!isRecord(payload)) {
    return false
  }
  const candidate = payload as Partial<ScanInput>
  return (
    typeof candidate.rootPath === 'string' &&
    typeof candidate.generatedAt === 'string' &&
    validateNodeTree(candidate.node)
  )
}

function App() {
  const [scanInput, setScanInput] = useState<ScanInput | null>(null)
  const [error, setError] = useState<string>('')
  const [staleDays, setStaleDays] = useState(180)
  const [staleAttribute, setStaleAttribute] = useState<StaleAttribute>('lastWrite')
  const [minSizeMb, setMinSizeMb] = useState(1024)
  const [sortBy, setSortBy] = useState<SortColumn>('size')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set<string>())
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set<string>())
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadInput = (payload: unknown) => {
    if (!validateInput(payload)) {
      setError('Invalid JSON format or file is too complex to process safely.')
      return
    }
    const typed = payload
    const { maxAgeDays } = getMaxNodeMetrics(typed.node)
    const maxSizeBytes = getMaxDescendantSizeBytes(typed.node)
    const suggestedMinSizeMb = roundDownToLeadingMagnitude((maxSizeBytes / MB) * 0.75)
    const suggestedStaleDays = Math.round(maxAgeDays * 0.75)
    const rootExpanded = new Set<string>([typed.node.path])
    setScanInput(typed)
    setMinSizeMb(Math.max(0, suggestedMinSizeMb))
    setStaleDays(Math.min(MAX_STALE_DAYS, Math.max(0, suggestedStaleDays)))
    setStaleAttribute('lastWrite')
    setExpandedPaths(rootExpanded)
    setSelectedPaths(new Set<string>())
    setError('')
  }

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    if (file.size > MAX_UPLOAD_SIZE_MB * MB) {
      setError(`JSON file is too large. Maximum supported size is ${MAX_UPLOAD_SIZE_MB} MB.`)
      event.target.value = ''
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
        } else if (sortBy === 'written') {
          compare =
            new Date(getNodeLastWriteTime(a)).getTime() -
            new Date(getNodeLastWriteTime(b)).getTime()
        } else {
          compare = ageInDays(getNodeLastWriteTime(a)) - ageInDays(getNodeLastWriteTime(b))
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

  const staleDescendantMap = useMemo(() => {
    const containsStale = new Map<string, boolean>()
    if (!sortedRoot) {
      return containsStale
    }

    const getDateForNode = (node: ScanNode): string =>
      getNodeDateForStaleAttribute(node, staleAttribute)

    const isNodeStale = (node: ScanNode) => ageInDays(getDateForNode(node)) >= staleDays

    // Post-order traversal so children are processed before parents
    const order: ScanNode[] = []
    const traversal: ScanNode[] = [sortedRoot]
    while (traversal.length > 0) {
      const node = traversal.pop()!
      order.push(node)
      for (const child of node.children ?? []) {
        traversal.push(child)
      }
    }

    for (let i = order.length - 1; i >= 0; i -= 1) {
      const node = order[i]
      const childHasStale = (node.children ?? []).some((child) => containsStale.get(child.path))
      containsStale.set(node.path, isNodeStale(node) || childHasStale)
    }

    return containsStale
  }, [sortedRoot, staleDays, staleAttribute])

  const selectionStateMap = useMemo(() => {
    const stateMap = new Map<string, SelectionState>()
    if (!sortedRoot) {
      return stateMap
    }

    // Collect nodes in pre-order so we can process post-order (children before parents)
    const order: ScanNode[] = []
    const traversal: ScanNode[] = [sortedRoot]
    while (traversal.length > 0) {
      const node = traversal.pop()!
      order.push(node)
      for (const child of node.children ?? []) {
        traversal.push(child)
      }
    }

    const counts = new Map<string, { selected: number; total: number }>()
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const node = order[i]
      let selected = selectedPaths.has(node.path) ? 1 : 0
      let total = 1

      for (const child of node.children ?? []) {
        const childCounts = counts.get(child.path)!
        selected += childCounts.selected
        total += childCounts.total
      }

      counts.set(node.path, { selected, total })

      let state: SelectionState
      if (selected === 0) {
        state = 'none'
      } else if (selected === total) {
        state = 'all'
      } else {
        state = 'partial'
      }

      stateMap.set(node.path, state)
    }

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

      if (selectionState === 'all') {
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

  const handleSortClick = (column: SortColumn) => {
    if (sortBy === column) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortBy(column)
    setSortDirection(column === 'name' ? 'asc' : 'desc')
  }

  const getSortMarker = (column: SortColumn) => {
    if (sortBy !== column) {
      return '↕'
    }
    return sortDirection === 'asc' ? '▲' : '▼'
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-content">

          <h1>
            Sift bytes. Filter junk.
            <br />
            Reclaim space. Keep the good.
          </h1>
          <p className="subtitle">
            Load a JSON scan report, explore the tree by size and age, and export a focused
            cleanup plan for archive or deletion scripts.
          </p>
          <div className="hero-actions">
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              Load JSON
            </button>
            <button
              type="button"
              onClick={exportSelection}
              disabled={recommendedItems.length === 0}
            >
              Export JSON ({recommendedItems.length})
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept="application/json"
              onChange={handleFileUpload}
              hidden
            />
            {IS_DEV ? (
              <button type="button" onClick={handleLoadSample} className="secondary">
                Load Sample
              </button>
            ) : null}
          </div>
        </div>
        <div className="hero-logo-wrap" aria-hidden="true">
          <img src={bytesiftLogo} alt="" className="hero-logo" />
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
            {'Min Size (MB)'}
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
            {'Stale (Days)'}
            <span className="control-label-marker control-label-marker-stale" aria-hidden="true" />
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
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
              style={{ flex: 1 }}
            />
            <select
              value={staleAttribute}
              onChange={(event) => {
                setStaleAttribute(event.target.value as StaleAttribute)
              }}
              aria-label="Select date attribute for stale calculation"
            >
              <option value="lastWrite">Last Write</option>
              <option value="created">Created</option>
              <option value="lastAccess">Last Access</option>
            </select>
          </div>
        </label>
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
          <button type="button" className="sort-header" onClick={() => handleSortClick('age')}>
            Age <span>{getSortMarker('age')}</span>
          </button>
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
              const dateToUse = getNodeDateForStaleAttribute(node, staleAttribute)
              const stale = ageInDays(dateToUse) >= staleDays
              const containsStaleDescendant = node.type === 'directory' && !stale && (staleDescendantMap.get(node.path) ?? false)
              const large = node.sizeBytes >= minSizeMb * MB
              const selectionState = selectionStateMap.get(node.path) ?? 'none'
              const selected = selectionState === 'all'
              const partial = selectionState === 'partial'
              let staleMarkerState = ''
              let staleMarkerTitle: string | undefined
              if (stale) {
                staleMarkerState = 'active'
                staleMarkerTitle = `Stale - Older than ${staleDays} days`
              } else if (containsStaleDescendant) {
                staleMarkerState = 'contains'
                staleMarkerTitle = 'Stale - Contains old files or folders'
              }
              const largeMarkerTitle = large ? `Large - Over ${formatBytes(minSizeMb * MB)}` : undefined

              return (
                <div className="tree-row" key={node.path}>
                  <span className="marker-stack" aria-hidden="true">
                    <span
                      className={`marker-cell marker-large ${large ? 'active' : ''}`}
                      title={largeMarkerTitle}
                    />
                    <span
                      className={`marker-cell marker-stale ${staleMarkerState}`}
                      title={staleMarkerTitle}
                    />
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
                    <span className="name-text" title={node.name}>
                      {truncateNodeName(node.name, node.type)}
                    </span>
                  </div>
                  <span>{formatBytes(node.sizeBytes)}</span>
                  <span>{formatDisplayDate(getNodeCreationTime(node))}</span>
                  <span>{formatDisplayDate(getNodeLastAccessTime(node))}</span>
                  <span>{formatDisplayDate(lastWriteTime)}</span>
                  <span>{ageInDays(dateToUse)} days</span>
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
