import { ContextMenu, ContextMenuItem } from "../primitives";

export interface SidebarContextMenuProps {
  x: number;
  y: number;
  onCreateChannel: () => void;
  onCreateCategory: () => void;
}

/**
 * Context menu for empty space in the channel sidebar.
 *
 * A category is just a structural channel, so "Create category" opens the same
 * editor as "Create channel" with that attribute pre-set - no separate creation
 * path to keep in step.
 */
export default function SidebarContextMenu({ x, y, onCreateChannel, onCreateCategory }: SidebarContextMenuProps) {
  return <ContextMenu x={x} y={y} label="Channel list actions" heading="Channels">
    <ContextMenuItem onSelect={onCreateChannel}>Create channel</ContextMenuItem>
    <ContextMenuItem onSelect={onCreateCategory} hint="Groups channels">Create category</ContextMenuItem>
  </ContextMenu>;
}
