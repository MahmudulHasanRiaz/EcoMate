'use client';

import React from 'react';
import { SWRConfig } from 'swr';

export const SWRProvider = ({ children }: { children: React.ReactNode }) => {
    return (
        <SWRConfig
            value={{
                fetcher: (resource, init) => fetch(resource, init).then(res => {
        if (!res.ok) {
          // Attempt to parse json for error message, but fallback to empty object if it's HTML/invalid
          return res.json().catch(() => ({}));
        }
        return res.json();
      }).catch((err) => {
        console.warn('[SWR_GLOBAL_FETCHER_ERROR]', err);
        return {};
      }),
                revalidateOnFocus: false, // Smartly avoid too many requests
                revalidateIfStale: true,
                dedupingInterval: 5000,   // Cache results for 5s to prevent ghost requests
            }}
        >
            {children}
        </SWRConfig>
    );
};
