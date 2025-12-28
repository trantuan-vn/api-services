export const EKYC_SERVICES = {
  DOCUMENT: {
    RECOGNIZE: {
      path: '/api/ekyc/recognize-document',
      price: 1000
    }
  },
  FACE: {
    SEARCH: {
      path: '/api/ekyc/face-search',
      price: 1000
    },
    LIVENESS: {
      path: '/api/ekyc/face-liveness',
      price: 1000
    },
    VERIFY: {
      path: '/api/ekyc/face-verify',
      price: 1000
    }
  }
} as const;

export const EKYC_SERVICE_PERMISSIONS = Object.values(EKYC_SERVICES)
  .flatMap(service => Object.values(service))
  .map(service => service.path);