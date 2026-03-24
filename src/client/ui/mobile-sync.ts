type BindMobileSyncInput = {
  initialMatches: boolean;
  setHudMobile: (matches: boolean) => void;
  setLogMobile: (matches: boolean) => void;
  bindViewport: (onMobileChange: (matches: boolean) => void) => void;
};

export const bindMobileSync = ({
  initialMatches,
  setHudMobile,
  setLogMobile,
  bindViewport,
}: BindMobileSyncInput) => {
  let isMobile = initialMatches;

  const apply = (matches: boolean) => {
    isMobile = matches;
    setHudMobile(matches);
    setLogMobile(matches);
  };

  apply(isMobile);
  bindViewport((matches) => apply(matches));

  return {
    getIsMobile: () => isMobile,
  };
};
