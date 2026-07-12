import { NextRequest, NextResponse } from 'next/server';
import { getTasks, PROJECTS } from '@/lib/kanban-reader';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } },
) {
  try {
    const { slug } = params;

    if (!(slug in PROJECTS)) {
      return NextResponse.json(
        { error: `Unknown project: ${slug}` },
        { status: 404 },
      );
    }

    const tasks = getTasks(slug);
    return NextResponse.json(tasks);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
