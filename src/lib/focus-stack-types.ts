export interface FocusStackImage {
  name: string;
  base64: string;
  mimeType: string;
}

export interface FocusStackOptions {
  detector?: 'ORB' | 'AKAZE';
  blurSigma?: number;
  blendTransitions?: boolean;
  blendKernelSize?: number;
}

export interface AlignmentDiagnostic {
  imageIndex: number;
  imageName: string;
  matchCount: number;
  inlierCount: number;
  reprojectionError: number;
  maxTranslation: number;
  aligned: boolean;
  warning?: string;
}

export interface FocusStackDiagnostics {
  referenceIndex: number;
  referenceSharpness: number;
  alignments: AlignmentDiagnostic[];
  totalTimeMs: number;
  stagesMs: {
    initialization: number;
    referenceSelection: number;
    featureDetection: number;
    matching: number;
    alignment: number;
    focusMapComputation: number;
    compositing: number;
    encoding: number;
  };
}

export interface FocusStackResult {
  result: {
    base64: string;
    mimeType: string;
    width: number;
    height: number;
  };
  diagnostics: FocusStackDiagnostics;
}

export type FocusStackErrorCode =
  | 'INSUFFICIENT_IMAGES'
  | 'ALIGNMENT_FAILED'
  | 'NO_FEATURES'
  | 'HOMOGRAPHY_FAILED'
  | 'PROCESSING_ERROR';

export interface FocusStackError {
  error: string;
  code: FocusStackErrorCode;
  details?: string;
}
