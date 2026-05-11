// M3 palette values that must be hardcoded — CSS variables are unavailable
// at AG Grid module-load time and cannot be used in inline style props.

export const GRID = {
  background:         '#FFFFFF',
  foreground:         '#191C20',
  headerBackground:   '#E8EEFB',
  headerText:         '#2D3748',
  border:             '#C3C7CF',
  rowHover:           '#EEF2FB',
  selectedRow:        '#D9E3F8',
} as const;

export const ROW_STATUS = {
  duplicateBg:        '#FFFBEB',
  duplicateBorder:    '#D97706',
  errorBg:            '#FEF2F2',
  errorBorder:        '#DC2626',
  editableBg:         '#FAFCFF',
} as const;

export const APP_BAR = {
  shadow:             'rgba(24,85,163,0.25)',
  inputBg:            'rgba(255,255,255,0.15)',
  subtitleText:       'rgba(255,255,255,0.75)',
} as const;
