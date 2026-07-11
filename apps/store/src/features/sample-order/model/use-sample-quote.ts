import { calculateSampleOrder } from "@essesion/api-client";
import { useQuery } from "@tanstack/react-query";

import type { SampleOrderOptions } from "./options";
import { sampleOrderApiOptions } from "./options";

export function useSampleQuote(options: SampleOrderOptions) {
  const designType =
    options.sampleType === "sewing" ? null : options.designType;

  return useQuery({
    queryKey: [
      "sample-order",
      "calculate",
      { sample_type: options.sampleType, design_type: designType },
    ],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await calculateSampleOrder({
        body: {
          sample_type: options.sampleType,
          options: sampleOrderApiOptions(options),
        },
        throwOnError: true,
      });
      return data;
    },
  });
}
