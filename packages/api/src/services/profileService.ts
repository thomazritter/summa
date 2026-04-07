import { queryOne, queryAll, execute } from '../db/connection.js';
import { safeJsonParse } from '../utils/validation.js';
import type { Profile, CreateProfileRequest, ProfileQuestion } from '@summarizer/shared';

// Initial questionnaire for new users
export const profileQuestions: ProfileQuestion[] = [
  {
    id: 'expertise',
    question: 'What is your level of familiarity with scientific literature?',
    targetField: 'expertise',
    options: [
      { value: 'beginner', label: 'Beginner', description: 'New to academic papers' },
      { value: 'intermediate', label: 'Intermediate', description: 'Read papers occasionally' },
      { value: 'advanced', label: 'Advanced', description: 'Regularly read papers in my field' },
      { value: 'expert', label: 'Expert', description: 'Publish and review papers' },
    ],
  },
  {
    id: 'focus',
    question: 'What aspect of articles interests you most?',
    targetField: 'focus',
    options: [
      { value: 'concepts', label: 'Core Concepts', description: 'Main ideas and theory' },
      { value: 'methodology', label: 'Methodology', description: 'How the research was done' },
      { value: 'results', label: 'Results', description: 'Findings and data' },
      { value: 'applications', label: 'Applications', description: 'Practical implications' },
      { value: 'all', label: 'Balanced', description: 'All aspects equally' },
    ],
  },
  {
    id: 'depth',
    question: 'How detailed do you want your summaries?',
    targetField: 'depth',
    options: [
      { value: 'brief', label: 'Brief', description: 'Quick overview (1-2 paragraphs)' },
      { value: 'moderate', label: 'Moderate', description: 'Standard summary (3-4 paragraphs)' },
      { value: 'detailed', label: 'Detailed', description: 'In-depth summary (5+ paragraphs)' },
      { value: 'comprehensive', label: 'Comprehensive', description: 'Full analysis' },
    ],
  },
  {
    id: 'context',
    question: 'What is your typical reading goal?',
    targetField: 'context',
    options: [
      { value: 'quick_review', label: 'Quick Review', description: 'Assess relevance quickly' },
      { value: 'learning', label: 'Learning', description: 'Understand the topic' },
      { value: 'research', label: 'Research', description: 'Deep analysis for my work' },
      { value: 'teaching', label: 'Teaching', description: 'Prepare to explain to others' },
    ],
  },
];

export const getProfileQuestions = (): ProfileQuestion[] => {
  return profileQuestions;
};

export const createProfile = async (userId: number, data: CreateProfileRequest): Promise<Profile> => {
  const row = await queryOne<ProfileRow>(
    `INSERT INTO profiles (user_id, name, expertise, focus, depth, context)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, data.name, data.expertise, data.focus, data.depth, data.context],
  );

  if (!row) {
    throw new Error('Failed to create profile');
  }
  return mapRowToProfile(row);
};

export const getProfileById = async (id: number): Promise<Profile | null> => {
  const row = await queryOne<ProfileRow>('SELECT * FROM profiles WHERE id = $1', [id]);
  if (!row) {
    return null;
  }
  return mapRowToProfile(row);
};

export const getProfilesByUserId = async (userId: number): Promise<Profile[]> => {
  const rows = await queryAll<ProfileRow>('SELECT * FROM profiles WHERE user_id = $1', [userId]);
  return rows.map(mapRowToProfile);
};

export const updateProfile = async (id: number, data: Partial<CreateProfileRequest>): Promise<Profile | null> => {
  const fields: string[] = [];
  const values: (string | number)[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(data.name);
  }
  if (data.expertise !== undefined) {
    fields.push(`expertise = $${paramIndex++}`);
    values.push(data.expertise);
  }
  if (data.focus !== undefined) {
    fields.push(`focus = $${paramIndex++}`);
    values.push(data.focus);
  }
  if (data.depth !== undefined) {
    fields.push(`depth = $${paramIndex++}`);
    values.push(data.depth);
  }
  if (data.context !== undefined) {
    fields.push(`context = $${paramIndex++}`);
    values.push(data.context);
  }

  if (fields.length === 0) {
    return getProfileById(id);
  }

  values.push(id);

  await execute(
    `UPDATE profiles SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
    values,
  );
  return getProfileById(id);
};

export const deleteProfile = async (id: number): Promise<boolean> => {
  const result = await execute('DELETE FROM profiles WHERE id = $1', [id]);
  return result.changes > 0;
};

// Internal types for database rows
interface ProfileRow {
  id: number;
  user_id: number;
  name: string;
  expertise: string;
  focus: string;
  depth: string;
  context: string;
  custom_preferences: string | null;
  created_at: string;
  updated_at: string;
}

const mapRowToProfile = (row: ProfileRow): Profile => {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    expertise: row.expertise as Profile['expertise'],
    focus: row.focus as Profile['focus'],
    depth: row.depth as Profile['depth'],
    context: row.context as Profile['context'],
    customPreferences: safeJsonParse<Record<string, unknown>>(row.custom_preferences),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
};
