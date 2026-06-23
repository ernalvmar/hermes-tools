import { NextRequest, NextResponse } from 'next/server';
import { readProject, readAllProjects, PROJECTS } from '@/lib/kanban-reader';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const project = searchParams.get('project');

    if (project) {
      if (!(project in PROJECTS)) {
        return NextResponse.json(
          { error: `Unknown project: ${project}` },
          { status: 404 },
        );
      }
      const stats = readProject(project);
      return NextResponse.json(stats);
    }

    const allStats = readAllProjects();
    return NextResponse.json(allStats);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
