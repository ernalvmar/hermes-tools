import { NextRequest, NextResponse } from 'next/server';
import { getRecentActivity, PROJECTS } from '@/lib/kanban-reader';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const project = searchParams.get('project');

    if (project && !(project in PROJECTS)) {
      return NextResponse.json(
        { error: `Unknown project: ${project}` },
        { status: 404 },
      );
    }

    const activity = getRecentActivity(project ?? undefined);
    return NextResponse.json(activity);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
