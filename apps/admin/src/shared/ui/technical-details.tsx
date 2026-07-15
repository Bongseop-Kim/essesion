import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ActionButton,
  Box,
  HStack,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";

export type TechnicalDetailsProps = {
  title?: string;
  json?: unknown;
  rawText?: string;
};

export function TechnicalDetails({
  title = "기술 정보",
  json,
  rawText,
}: TechnicalDetailsProps) {
  const body =
    rawText ?? (json === undefined ? undefined : JSON.stringify(json, null, 2));

  const copy = async () => {
    if (body === undefined) return;
    try {
      await navigator.clipboard.writeText(body);
      snackbar("기술 정보를 복사했습니다.");
    } catch {
      snackbar("기술 정보를 복사하지 못했습니다.");
    }
  };

  return (
    <Accordion type="single" collapsible variant="separated">
      <AccordionItem value="technical-details">
        <AccordionTrigger>{title}</AccordionTrigger>
        <AccordionContent>
          {body === undefined ? null : (
            <VStack gap="x3" alignItems="stretch">
              <Box
                as="pre"
                maxHeight={384}
                overflowY="auto"
                bg="bg.neutral-weak"
                borderRadius="r2"
                p="x4"
                className="whitespace-pre-wrap break-words"
              >
                <Text as="code" textStyle="caption">
                  {body}
                </Text>
              </Box>
              <HStack justify="flex-end">
                <ActionButton
                  type="button"
                  size="small"
                  variant="neutralOutline"
                  onClick={() => void copy()}
                >
                  기술 정보 복사
                </ActionButton>
              </HStack>
            </VStack>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
