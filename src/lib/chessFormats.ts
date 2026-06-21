export type ChessFormatId =
  | 'bullet_1_0'
  | 'blitz_3_0'
  | 'blitz_3_2'
  | 'blitz_5_0'
  | 'rapid_10_0'
  | 'rapid_15_10';

export type ChessFormatFamily = 'bullet' | 'blitz' | 'rapid';

export interface ChessTimeControlFormat {
  id: ChessFormatId;
  family: ChessFormatFamily;
  label: string;
  timeControl: string;
  baseMinutes: number;
  incrementSeconds: number;
  clockMs: number;
  incrementMs: number;
}

export const CHESS_TIME_CONTROL_FORMATS: ChessTimeControlFormat[] = [
  { id: 'bullet_1_0', family: 'bullet', label: 'Bullet 1+0', timeControl: '1+0', baseMinutes: 1, incrementSeconds: 0, clockMs: 60_000, incrementMs: 0 },
  { id: 'blitz_3_0', family: 'blitz', label: 'Blitz 3+0', timeControl: '3+0', baseMinutes: 3, incrementSeconds: 0, clockMs: 180_000, incrementMs: 0 },
  { id: 'blitz_3_2', family: 'blitz', label: 'Blitz 3+2', timeControl: '3+2', baseMinutes: 3, incrementSeconds: 2, clockMs: 180_000, incrementMs: 2_000 },
  { id: 'blitz_5_0', family: 'blitz', label: 'Blitz 5+0', timeControl: '5+0', baseMinutes: 5, incrementSeconds: 0, clockMs: 300_000, incrementMs: 0 },
  { id: 'rapid_10_0', family: 'rapid', label: 'Rapid 10+0', timeControl: '10+0', baseMinutes: 10, incrementSeconds: 0, clockMs: 600_000, incrementMs: 0 },
  { id: 'rapid_15_10', family: 'rapid', label: 'Rapid 15+10', timeControl: '15+10', baseMinutes: 15, incrementSeconds: 10, clockMs: 900_000, incrementMs: 10_000 },
];

export const DEFAULT_CHESS_FORMAT_ID: ChessFormatId = 'blitz_5_0';
export const DEFAULT_CHESS_FORMAT = CHESS_TIME_CONTROL_FORMATS.find((format) => format.id === DEFAULT_CHESS_FORMAT_ID)!;

export function chessFormatById(id: string | null | undefined): ChessTimeControlFormat {
  return CHESS_TIME_CONTROL_FORMATS.find((format) => format.id === id) ?? DEFAULT_CHESS_FORMAT;
}

export function chessFormatByTimeControl(timeControl: string | null | undefined): ChessTimeControlFormat {
  const normalized = String(timeControl ?? '').trim().toLowerCase();
  return CHESS_TIME_CONTROL_FORMATS.find((format) => (
    format.timeControl.toLowerCase() === normalized ||
    format.id.toLowerCase() === normalized ||
    format.label.toLowerCase() === normalized
  )) ?? DEFAULT_CHESS_FORMAT;
}

export function chessFormatFamilyLabel(family: ChessFormatFamily): string {
  return family.toUpperCase();
}
