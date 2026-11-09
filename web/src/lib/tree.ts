import type { Agent } from "./types"

export type TreeNode = { agent: Agent; children: TreeNode[] }

export function buildTree(agents: Agent[]): TreeNode[] {
  const nodes = new Map(agents.map((a) => [a.id, { agent: a, children: [] as TreeNode[] }]))
  const roots: TreeNode[] = []
  for (const n of [...nodes.values()].sort((a, b) => a.agent.startedAt - b.agent.startedAt)) {
    const parent = n.agent.parentId ? nodes.get(n.agent.parentId) : undefined
    ;(parent ? parent.children : roots).push(n)
  }
  return roots
}
