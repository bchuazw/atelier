"""Node layout helpers — keep new children from stacking on top of each other.

The earlier behavior (`new_x = parent.x + 240`) caused every sibling fork from
the same parent to land at the exact same coordinates — only the topmost was
visible, and a user who forked three times would believe two of them silently
failed.

`next_child_position` counts how many siblings the parent already has and
returns a position that fans out horizontally (alternating left / right of
the parent) so each new fork lands somewhere visible.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from atelier_api.db.models import Node

# Card dimensions (must match VariantNode.tsx). Horizontal step is the card
# width plus a comfortable gap so dashed merge edges + edge labels still fit.
CHILD_X_STEP = 290.0
CHILD_Y_STEP = 290.0


async def next_child_position(
    session: AsyncSession,
    parent: Node,
    *,
    bias_right: bool = False,
) -> tuple[float, float]:
    """Compute (x, y) for a new child of `parent` so siblings don't overlap.

    Children fan out below the parent in a deterministic spread:
      sibling 0 → directly below parent
      sibling 1 → 290px to the right
      sibling 2 → 290px to the left
      sibling 3 → 580px to the right, etc.

    The fan-out is symmetric so the parent stays roughly visually centered as
    children grow. `bias_right=True` is for media generations (Hero) where we
    want a clear left/right split between the prompt-fork variants and the
    media variants.
    """
    result = await session.execute(
        select(func.count())
        .select_from(Node)
        .where(Node.parent_id == parent.id)
    )
    sibling_count = int(result.scalar() or 0)

    # Index 0 → 0, index 1 → +1, 2 → -1, 3 → +2, 4 → -2, ...
    if sibling_count == 0:
        offset_index = 0
    else:
        # Alternating: odd → right, even → left
        side = 1 if sibling_count % 2 == 1 else -1
        magnitude = (sibling_count + 1) // 2
        offset_index = side * magnitude

    if bias_right:
        # Push the whole fan rightward by half a step so a media child won't
        # collide with prompt-fork siblings centered on the parent.
        offset_index += 0.5

    x = parent.position_x + offset_index * CHILD_X_STEP
    y = parent.position_y + CHILD_Y_STEP
    return x, y
