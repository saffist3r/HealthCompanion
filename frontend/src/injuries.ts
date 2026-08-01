/** Injury UI helpers (kept local — frontend Docker image has no @health-companion/shared). */

export type InjuryType =
  | 'sprain'
  | 'tendinitis'
  | 'muscle_strain'
  | 'bruise'
  | 'fracture'
  | 'other';

export type InjuryStatus = 'active' | 'healing' | 'healed';

export type InjuryBodyArea =
  | 'knee_left'
  | 'knee_right'
  | 'ankle_left'
  | 'ankle_right'
  | 'shoulder_left'
  | 'shoulder_right'
  | 'elbow_left'
  | 'elbow_right'
  | 'wrist_left'
  | 'wrist_right'
  | 'hip_left'
  | 'hip_right'
  | 'lower_back'
  | 'upper_back'
  | 'neck'
  | 'foot_left'
  | 'foot_right'
  | 'hamstring_left'
  | 'hamstring_right'
  | 'calf_left'
  | 'calf_right'
  | 'other';

export type InjuryActivityKind = 'sport' | 'kine' | 'osteo' | 'podologue' | 'gym' | 'other';

export interface InjuryPainLog {
  id: string;
  injuryId: string;
  date: string;
  painScore: number;
  relatedActivityKind?: string | null;
  relatedActivityLabel?: string | null;
  notes?: string | null;
  createdAt?: number | null;
}

export interface Injury {
  id: string;
  title: string;
  injuryType: InjuryType | string;
  injuryTypeLabel?: string;
  bodyArea: InjuryBodyArea | string;
  bodyAreaOther?: string | null;
  bodyAreaLabel?: string;
  startedOn: string;
  status: InjuryStatus | string;
  healedOn?: string | null;
  relatedActivityKinds: InjuryActivityKind[] | string[];
  relatedActivityLabels?: string[];
  exerciseNotes?: string | null;
  notes?: string | null;
  createdAt?: number | null;
  latestPain?: InjuryPainLog | null;
  todayPain?: InjuryPainLog | null;
  recentPain?: InjuryPainLog[];
}

export const INJURY_TYPE_OPTIONS: Array<{ value: InjuryType; label: string }> = [
  { value: 'sprain', label: 'Sprain' },
  { value: 'tendinitis', label: 'Tendinitis' },
  { value: 'muscle_strain', label: 'Muscle strain' },
  { value: 'bruise', label: 'Bruise' },
  { value: 'fracture', label: 'Fracture' },
  { value: 'other', label: 'Other' },
];

export const INJURY_BODY_AREA_OPTIONS: Array<{ value: InjuryBodyArea; label: string }> = [
  { value: 'knee_left', label: 'Left knee' },
  { value: 'knee_right', label: 'Right knee' },
  { value: 'ankle_left', label: 'Left ankle' },
  { value: 'ankle_right', label: 'Right ankle' },
  { value: 'shoulder_left', label: 'Left shoulder' },
  { value: 'shoulder_right', label: 'Right shoulder' },
  { value: 'elbow_left', label: 'Left elbow' },
  { value: 'elbow_right', label: 'Right elbow' },
  { value: 'wrist_left', label: 'Left wrist' },
  { value: 'wrist_right', label: 'Right wrist' },
  { value: 'hip_left', label: 'Left hip' },
  { value: 'hip_right', label: 'Right hip' },
  { value: 'hamstring_left', label: 'Left hamstring' },
  { value: 'hamstring_right', label: 'Right hamstring' },
  { value: 'calf_left', label: 'Left calf' },
  { value: 'calf_right', label: 'Right calf' },
  { value: 'foot_left', label: 'Left foot' },
  { value: 'foot_right', label: 'Right foot' },
  { value: 'lower_back', label: 'Lower back' },
  { value: 'upper_back', label: 'Upper back' },
  { value: 'neck', label: 'Neck' },
  { value: 'other', label: 'Other' },
];

export const INJURY_ACTIVITY_OPTIONS: Array<{ value: InjuryActivityKind; label: string }> = [
  { value: 'sport', label: 'Sport' },
  { value: 'gym', label: 'Gym' },
  { value: 'kine', label: 'Kiné' },
  { value: 'osteo', label: 'Ostéo' },
  { value: 'podologue', label: 'Podologue' },
  { value: 'other', label: 'Other' },
];
