export type CpuCharacter = 'ivan' | 'vinnie';

// ==================== IVAN TAUNTS ====================

export const IVAN_CAPTURE_TAUNTS = [
  "Another block for the collection!",
  "Yoink! That square is mine.",
  "My crew understood the assignment."
];

export const IVAN_CHECK_TAUNTS = [
  "Your king needs a new spawn point.",
  "Check! Time to build an escape route.",
  "Your castle needs an upgrade."
];

export const IVAN_CHECKMATE_TAUNTS = [
  "Checkmate! GG, builder.",
  "Victory unlocked. Run it back?",
  "The crown stays on my block."
];

export const IVAN_GENERAL_TAUNTS = [
  "Big brain energy only.",
  "Every block has a purpose.",
  "Build a plan. Then build a better one."
];

export const IVAN_PLAYER_MOVE_TAUNTS = [
  "Okay, I see the vision.",
  "Your crew is putting in work!",
  "That move has main-character energy."
];

export const IVAN_OPENING_TAUNTS = [
  "Welcome to my block. Let’s build a good game.",
  "Crew ready. Board ready. You ready?",
  "New match. New possibilities."
];

export const IVAN_IDLE_TAUNTS = [
  "Planning the next big build?",
  "The crew is ready when you are.",
  "Take your time. Make it a good move.",
  "Your next move could change everything."
];

// ==================== VINNIE TAUNTS ====================

export const VINNIE_CAPTURE_TAUNTS = [
  "Another block for the collection!",
  "Yoink! That square is mine.",
  "My crew understood the assignment."
];

export const VINNIE_CHECK_TAUNTS = [
  "Your king needs a new spawn point.",
  "Check! Time to build an escape route.",
  "Your castle needs an upgrade."
];

export const VINNIE_CHECKMATE_TAUNTS = [
  "Checkmate! GG, builder.",
  "Victory unlocked. Run it back?",
  "The crown stays on my block."
];

export const VINNIE_GENERAL_TAUNTS = [
  "Big brain energy only.",
  "Every block has a purpose.",
  "Build a plan. Then build a better one."
];

export const VINNIE_PLAYER_MOVE_TAUNTS = [
  "Okay, I see the vision.",
  "Your crew is putting in work!",
  "That move has main-character energy."
];

export const VINNIE_OPENING_TAUNTS = [
  "Welcome to my block. Let’s build a good game.",
  "Crew ready. Board ready. You ready?",
  "New match. New possibilities."
];

export const VINNIE_IDLE_TAUNTS = [
  "Planning the next big build?",
  "The crew is ready when you are.",
  "Take your time. Make it a good move.",
  "Your next move could change everything."
];

// ==================== CHARACTER CONFIG ====================

export interface CharacterConfig {
  name: string;
  title: string;
  thinkingText: string;
  winText: string;
  loseText: string;
  taunts: {
    capture: string[];
    check: string[];
    checkmate: string[];
    general: string[];
    playerMove: string[];
    opening: string[];
    idle: string[];
  };
}

export const CHARACTERS: Record<CpuCharacter, CharacterConfig> = {
  ivan: {
    name: 'BLOX BARON',
    title: 'Block Strategist',
    thinkingText: 'BARON IS PLANNING...',
    winText: 'BLOX BARON WINS!',
    loseText: 'YOU DEFEATED BLOX BARON!',
    taunts: {
      capture: IVAN_CAPTURE_TAUNTS,
      check: IVAN_CHECK_TAUNTS,
      checkmate: IVAN_CHECKMATE_TAUNTS,
      general: IVAN_GENERAL_TAUNTS,
      playerMove: IVAN_PLAYER_MOVE_TAUNTS,
      opening: IVAN_OPENING_TAUNTS,
      idle: IVAN_IDLE_TAUNTS,
    },
  },
  vinnie: {
    name: 'ROOK RANGER',
    title: 'Sky Island Champion',
    thinkingText: 'RANGER IS PLANNING...',
    winText: 'ROOK RANGER WINS!',
    loseText: 'YOU DEFEATED ROOK RANGER! GG.',
    taunts: {
      capture: VINNIE_CAPTURE_TAUNTS,
      check: VINNIE_CHECK_TAUNTS,
      checkmate: VINNIE_CHECKMATE_TAUNTS,
      general: VINNIE_GENERAL_TAUNTS,
      playerMove: VINNIE_PLAYER_MOVE_TAUNTS,
      opening: VINNIE_OPENING_TAUNTS,
      idle: VINNIE_IDLE_TAUNTS,
    },
  },
};
