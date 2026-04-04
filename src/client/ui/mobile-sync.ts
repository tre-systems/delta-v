type BindMobileSyncInput = {
  initialMatches: boolean;
  setHudMobile: (matches: boolean) => void;
  setShipListMobile: (matches: boolean) => void;
  setLogMobile: (matches: boolean, viewportWidth: number) => void;
  bindViewport: (
    onMobileChange: (matches: boolean) => void,
    onResize: () => void,
  ) => void;
};

export const bindMobileSync = ({
  initialMatches,
  setHudMobile,
  setShipListMobile,
  setLogMobile,
  bindViewport,
}: BindMobileSyncInput) => {
  let isMobile = initialMatches;

  const apply = (matches: boolean) => {
    isMobile = matches;
    setHudMobile(matches);
    setShipListMobile(matches);
    setLogMobile(matches, window.innerWidth);
  };

  const onResize = () => {
    if (isMobile) {
      setLogMobile(true, window.innerWidth);
    }
  };

  apply(isMobile);
  bindViewport(apply, onResize);
};
