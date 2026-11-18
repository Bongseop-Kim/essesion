import { ActionButton } from "@essesion/shared";
import { useNavigate } from "react-router";

/** 상세 화면 제목 옆 "목록으로" — 모바일은 사이드바가 메뉴 뒤에 있어 목록으로 돌아갈 길이 따로 필요하다. */
export function BackToListButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <ActionButton variant="ghost" onClick={() => navigate(to)}>
      목록으로
    </ActionButton>
  );
}
