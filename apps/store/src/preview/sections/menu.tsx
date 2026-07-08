import {
  HStack,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@essesion/shared";

import { Section } from "../section";

export function MenuSection() {
  return (
    <Section title="메뉴">
      <HStack>
        <Menu>
          <MenuTrigger>작업</MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => console.log("열기")}>열기</MenuItem>
            <MenuItem onSelect={() => console.log("이름 변경")}>
              이름 변경
            </MenuItem>
            <MenuSeparator />
            <MenuGroup label="공유">
              <MenuItem onSelect={() => console.log("링크 복사")}>
                링크 복사
              </MenuItem>
              <MenuItem disabled>초대 보내기</MenuItem>
            </MenuGroup>
            <MenuSeparator />
            <MenuItem tone="critical" onSelect={() => console.log("삭제")}>
              삭제
            </MenuItem>
          </MenuContent>
        </Menu>
      </HStack>
    </Section>
  );
}
