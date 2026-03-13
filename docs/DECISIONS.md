# SpotiCheck Analytics - Decisions Log

| Decision | Reason | Impact | Date |
| --- | --- | --- | --- |
| Chọn FastAPI + Playwright + httpx | Phù hợp cho backend API + Spotify scraping hybrid | High | 2026-03-06 |
| Không dùng Redis ở MVP | Giữ triển khai đơn giản, dùng background task | Medium | 2026-03-06 |
| Giữ nguyên layout UI gốc | Yêu cầu giữ UX hiện có, chỉ thêm tính năng | Medium | 2026-03-06 |
| Tách `final3.html` thành HTML/CSS/JS | Dễ maintain và mở rộng tính năng | Medium | 2026-03-06 |
| Áp dụng AGENTS governance root + subfolders | Giảm regression khi làm việc multi-agent | Medium | 2026-03-13 |
| Enable optional crawl dedupe theo user/group | Tránh tạo item trùng, không đổi default contract | Medium | 2026-03-13 |
