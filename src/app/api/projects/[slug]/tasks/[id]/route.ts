import { NextRequest, NextResponse } from 'next/server';
import { getTaskById, PROJECTS } from '@/lib/kanban-reader';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string; id: string } },
) {
  try {
    const { slug, id } = params;

    if (!(slug in PROJECTS)) {
      return NextResponse.json(
        { error: `Unknown project: ${slug}` },
        { status: 404 },
      );
    }

    const task = getTaskById(slug, id);

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 },
      );
    }

    return NextResponse.json(task);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
