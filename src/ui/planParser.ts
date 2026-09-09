import {
  ProjectName,
  getProjectDescriptor,
  PlannedFeature,
  TicketMeta,
  TicketType,
  TicketCategory,
} from './types';

export const MAX_TICKET_TITLE_LENGTH = 48;

export interface FeatureFlagCandidate {
  name: string;
  description: string;
  projectId?: number;
  project?: ProjectName;
}

export interface MajorIdea {
  id: string;
  title: string;
  details: string;
  why: string;
}

export interface ParsedPlanData {
  plannedFeatures: PlannedFeature[];
  featureFlags: FeatureFlagCandidate[];
  majorIdeas: MajorIdea[];
  rawMarkdown: string;
}

export function parsePlannedWorkMarkdown(
  raw: string = '',
  includeModularTickets = true,
  overrideDetailsMap?: Record<string, string>,
  overrideMetasMap?: Record<string, TicketMeta>
): ParsedPlanData {
  const plannedFeatures: PlannedFeature[] = [];
  const featureFlags: FeatureFlagCandidate[] = [];
  const majorIdeas: MajorIdea[] = [];

  if (raw) {
    const sections = raw.split(/(?=\n## )/);

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) continue;

      const cleaned = trimmed.replace(/^##+\s*/, '');
      const firstLineEnd = cleaned.indexOf('\n');
      const headerLine = firstLineEnd !== -1 ? cleaned.substring(0, firstLineEnd).trim() : cleaned;
      const body = firstLineEnd !== -1 ? cleaned.substring(firstLineEnd + 1).trim() : '';

      const featureMatch = headerLine.match(/^Planned Feature (\d+):\s*(.*)$/i);
      if (featureMatch) {
        const number = parseInt(featureMatch[1], 10);
        const title = featureMatch[2];

        const complexityMatch = body.match(/\*\*Complexity\*\*:\s*([^\n]+)/i);
        const flagMatch = body.match(/\*\*(?:Feature\s*)?Flag\*\*:\s*`?([a-z0-9_]+)`?/i);
        const featureFlag = flagMatch ? flagMatch[1].trim() : undefined;

        let rationale: string | undefined;
        const rationaleMatch = body.match(/### Rationale\s*\n([\s\S]*?)(?=\n#|\n---|\n$)/i);
        if (rationaleMatch) {
          rationale = rationaleMatch[1].trim();
        }

        const breakdown: string[] = [];
        const breakdownMatch = body.match(/### Feature Breakdown\s*\n([\s\S]*?)(?=\n#|\n---|\n$)/i);
        if (breakdownMatch) {
          const breakdownLines = breakdownMatch[1].split('\n');
          let currentItem = '';
          for (const line of breakdownLines) {
            const itemMatch = line.match(/^\d+\.\s*(.*)$/);
            if (itemMatch) {
              if (currentItem) breakdown.push(currentItem);
              currentItem = itemMatch[1].trim();
            } else if (line.trim().startsWith('-')) {
              currentItem += (currentItem ? '\n  ' : '') + line.trim();
            } else if (currentItem && line.trim()) {
              currentItem += ' ' + line.trim();
            }
          }
          if (currentItem) breakdown.push(currentItem);
        }

        const techDetails: string[] = [];
        const openQuestions: string[] = [];
        const techMatch = body.match(/### Technical Detail & Open Questions\s*\n([\s\S]*?)(?=\n#|\n---|\n$)/i);
        if (techMatch) {
          const lines = techMatch[1].split('\n');
          for (const line of lines) {
            const lineTrimmed = line.trim();
            if (lineTrimmed.startsWith('- **Technical Detail**:')) {
              techDetails.push(lineTrimmed.replace(/^- \*\*Technical Detail\*\*:\s*/, ''));
            } else if (lineTrimmed.startsWith('- **Open Questions**:')) {
              openQuestions.push(lineTrimmed.replace(/^- \*\*Open Questions\*\*:\s*/, ''));
            } else if (lineTrimmed.startsWith('- ')) {
              techDetails.push(lineTrimmed.replace(/^- /, ''));
            }
          }
        }

        const typeMatch = body.match(/\*\*(?:Type|Category)\*\*:\s*([^\n]+)/i);
        const typeText = typeMatch ? typeMatch[1].trim() : '';
        let type: TicketType = 'Feature';
        if (typeText.toLowerCase().includes('bug')) {
          type = 'Bug';
        } else if (typeText.toLowerCase().includes('idea')) {
          type = 'Idea';
        } else if (typeText.toLowerCase().includes('tool')) {
          type = 'Tools';
        } else if (typeText.toLowerCase().includes('platform') || typeText.toLowerCase().includes('technical')) {
          type = 'Platform';
        }

        const isCompleted = headerLine.toLowerCase().includes('(completed)') || body.toLowerCase().includes('status: completed');
        const cleanTitle = title.replace(/\s*\([^)]*completed[^)]*\)/i, '').trim();

        plannedFeatures.push({
          id: `feature-${number}`,
          number,
          ticketId: String(number),
          title: cleanTitle,
          type,
          category: type,
          complexity: complexityMatch ? complexityMatch[1].trim() : 'Medium',
          rationale,
          breakdown,
          technicalDetails: techDetails.length > 0 ? techDetails : undefined,
          openQuestions: openQuestions.length > 0 ? openQuestions : undefined,
          isCompleted: isCompleted ? true : undefined,
          featureFlag,
          projectId: undefined,
          project: undefined,
        });
      }
    }
  }

  // Construct features from modular tickets
  if (includeModularTickets) {
    const metasMap = overrideMetasMap || {};
    const detailsMap = overrideDetailsMap || {};

    for (const ticketId in metasMap) {
      const meta = metasMap[ticketId];
      if (!meta) continue;

      let num = meta.id;
      if (num === undefined) {
        const parsed = parseInt(ticketId.replace(/^[a-zA-Z0-9]+[-_:]/, ''), 10);
        num = isNaN(parsed) ? parseInt(ticketId, 10) : parsed;
      }
      if (isNaN(num)) continue;

      const detailRaw = detailsMap[ticketId] || '';

      const rationaleMatch = detailRaw.match(/(?:##|###)\s*(?:Summary|Rationale)\s*\n([\s\S]*?)(?=\n##|\n###|\n#|$)/i);

      const breakdown: string[] = [];
      const bdMatch = detailRaw.match(/(?:##|###)\s*Feature Breakdown\s*\n([\s\S]*?)(?=\n##|\n###|\n#|$)/i);
      if (bdMatch) {
        const lines = bdMatch[1].split('\n');
        let currentItem = '';
        for (const line of lines) {
          const itemMatch = line.match(/^\d+\.\s*(.*)$/);
          if (itemMatch) {
            if (currentItem) breakdown.push(currentItem);
            currentItem = itemMatch[1].trim();
          } else if (line.trim().startsWith('-') || line.trim().startsWith('*') || line.trim().startsWith('•')) {
            if (currentItem) {
              currentItem += '\n  ' + line.trim();
            } else {
              breakdown.push(line.trim().replace(/^[-*•]\s*/, ''));
            }
          } else if (currentItem && line.trim()) {
            currentItem += ' ' + line.trim();
          }
        }
        if (currentItem) breakdown.push(currentItem);
      }

      const techDetails: string[] = [];
      const openQuestions: string[] = [];
      const techMatch = detailRaw.match(/(?:##|###)\s*Technical Detail & Open Questions\s*\n([\s\S]*?)(?=\n##|\n###|\n#|$)/i);
      if (techMatch) {
        const lines = techMatch[1].split('\n');
        for (const line of lines) {
          const lineTrimmed = line.trim();
          if (lineTrimmed.startsWith('- **Technical Detail**:')) {
            techDetails.push(lineTrimmed.replace(/^[-*•]\s*\*\*Technical Detail\*\*:\s*/, ''));
          } else if (
            lineTrimmed.startsWith('- **Open Question**:') ||
            lineTrimmed.startsWith('* **Open Question**:') ||
            lineTrimmed.startsWith('- **Open Questions**:') ||
            lineTrimmed.startsWith('* **Open Questions**:')
          ) {
            openQuestions.push(lineTrimmed.replace(/^[-*•]\s*\*\*Open Questions?\*\*:\s*/, ''));
          } else if (lineTrimmed.startsWith('- ') || lineTrimmed.startsWith('* ') || lineTrimmed.startsWith('• ')) {
            techDetails.push(lineTrimmed.replace(/^[-*•]\s*/, ''));
          }
        }
      }

      const effectiveRationale = rationaleMatch
        ? rationaleMatch[1].trim()
        : (!bdMatch && !techMatch && detailRaw)
        ? detailRaw.trim()
        : undefined;

      const projDesc =
        getProjectDescriptor(meta.projectId ?? (meta.project as string | number)) ||
        getProjectDescriptor(1);
      const projectCode = projDesc?.code || meta.project || 'Prof';

      const existingIdx = plannedFeatures.findIndex(
        (pf) => pf.ticketId === ticketId || (pf.number === num && pf.projectId === projDesc?.id)
      );
      const existing = existingIdx >= 0 ? plannedFeatures[existingIdx] : undefined;

      const detailTitleMatch = detailRaw.match(/^#\s*(?:Ticket\s*#?\d+\s*:\s*|\d+\s*:\s*)?([^\n]+)/im);
      const rawTitle = (meta.title && meta.title.trim()) || (detailTitleMatch ? detailTitleMatch[1].trim() : '') || existing?.title || '';
      const effectiveTitle = rawTitle.slice(0, MAX_TICKET_TITLE_LENGTH);

      const detailTypeMatch = detailRaw.match(/\*\*(?:Type|Category)\*\*:\s*([^\n]+)/i);
      const effectiveType = meta.type || meta.category || (detailTypeMatch ? detailTypeMatch[1].trim() as TicketType : undefined) || existing?.type || existing?.category || 'Feature';

      const detailComplexityMatch = detailRaw.match(/\*\*Complexity\*\*:\s*([^\n]+)/i);
      const effectiveComplexity = meta.complexity || (detailComplexityMatch ? detailComplexityMatch[1].trim() : undefined) || existing?.complexity || 'Medium';

      const detailEffortMatch = detailRaw.match(/\*\*Estimated Effort\*\*:\s*([^\n]+)/i);
      const effectiveEffort = meta.estimatedEffort || (detailEffortMatch ? detailEffortMatch[1].trim() : undefined) || existing?.estimatedEffort || 'N/A';

      const effectiveFeatureFlag = meta.featureFlag || existing?.featureFlag;
      const isCompleted = meta.status === 'Completed' || (meta.status === undefined && existing?.isCompleted);
      const isRejected = meta.status === 'Rejected' || (meta.status === undefined && existing?.isRejected);

      const modularFeature: PlannedFeature = {
        id: `feature-${projectCode}-${num}`,
        number: num,
        ticketId,
        title: effectiveTitle,
        type: effectiveType,
        category: effectiveType,
        complexity: effectiveComplexity,
        estimatedEffort: effectiveEffort,
        rationale: effectiveRationale || existing?.rationale,
        breakdown: breakdown.length > 0 ? breakdown : (existing?.breakdown || []),
        technicalDetails: techDetails.length > 0 ? techDetails : existing?.technicalDetails,
        openQuestions: openQuestions.length > 0 ? openQuestions : existing?.openQuestions,
        featureFlag: effectiveFeatureFlag,
        projectId: projDesc?.id,
        project: projDesc?.name,
        isCompleted,
        isRejected,
        rawDetail: detailRaw || existing?.rawDetail || undefined,
      };

      if (existingIdx >= 0) {
        plannedFeatures[existingIdx] = modularFeature;
      } else {
        plannedFeatures.push(modularFeature);
      }
    }
  }

  return {
    plannedFeatures: plannedFeatures.sort((a, b) => a.number - b.number),
    featureFlags,
    majorIdeas,
    rawMarkdown: raw,
  };
}
