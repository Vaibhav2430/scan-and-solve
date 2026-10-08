export type ScanRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScanRegionMessage = {
  type: "SCAN_REGION";
  rect: ScanRect;
  viewport: {
    width: number;
    height: number;
  };
};

export type ScanState = {
  id: string;
  imageDataUrl: string;
  createdAt: number;
};

export type ScanErrorState = {
  message: string;
  createdAt: number;
};
