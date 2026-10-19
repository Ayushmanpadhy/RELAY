import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.store.firestore import (
    set_job_internal,
    set_job_public,
    set_part,
    group_jobs_into_submissions,
    get_submission_iterations,
)


@pytest.mark.asyncio
async def test_multi_iteration_grouping_unit():
    """Verify group_jobs_into_submissions groups 5 follow-ups into 1 submission with correct iterationCount."""
    root_id = "job-thread-root-1"
    jobs = [
        {
            "id": root_id,
            "rootJobId": root_id,
            "parentJobId": None,
            "iteration": 1,
            "fullPrompt": "Initial task prompt",
            "status": "done",
            "createdAt": "2026-10-19T10:00:00Z",
            "reassignments": 1,
        },
        {
            "id": "job-thread-it-2",
            "rootJobId": root_id,
            "parentJobId": root_id,
            "iteration": 2,
            "fullPrompt": "Change format to JSON",
            "status": "done",
            "createdAt": "2026-10-19T10:05:00Z",
            "reassignments": 0,
        },
        {
            "id": "job-thread-it-3",
            "rootJobId": root_id,
            "parentJobId": "job-thread-it-2",
            "iteration": 3,
            "fullPrompt": "Add 5 more items",
            "status": "done",
            "createdAt": "2026-10-19T10:10:00Z",
            "reassignments": 2,
        },
        {
            "id": "job-thread-it-4",
            "rootJobId": root_id,
            "parentJobId": "job-thread-it-3",
            "iteration": 4,
            "fullPrompt": "Sort alphabetically",
            "status": "done",
            "createdAt": "2026-10-19T10:15:00Z",
            "reassignments": 0,
        },
        {
            "id": "job-thread-it-5",
            "rootJobId": root_id,
            "parentJobId": "job-thread-it-4",
            "iteration": 5,
            "fullPrompt": "Final refinement",
            "status": "working",
            "createdAt": "2026-10-19T10:20:00Z",
            "reassignments": 1,
        },
    ]

    submissions = group_jobs_into_submissions(jobs)
    # Must group into exactly 1 submission
    assert len(submissions) == 1
    sub = submissions[0]
    assert sub["id"] == root_id
    assert sub["rootJobId"] == root_id
    assert sub["iterationCount"] == 5
    assert len(sub["iterations"]) == 5
    # Reflects latest job's state
    assert sub["status"] == "working"
    assert sub["latestJobId"] == "job-thread-it-5"
    assert sub["reassignments"] == 4  # 1 + 0 + 2 + 0 + 1


@pytest.mark.asyncio
async def test_admin_and_user_submission_api():
    """Verify /api/jobs and /api/admin/jobs group tasks into 1 submission, and detail returns iterations."""
    user_headers = {"Authorization": "Bearer dev-user-multi"}
    admin_login_payload = {
        "email": "admin@relay.platform",
        "password": "RelayProductionAdmin2026!",
    }

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Admin login to obtain token
        login_res = await client.post("/api/admin/auth/login", json=admin_login_payload)
        assert login_res.status_code == 200
        admin_token = login_res.json()["token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # 2. Seed 4 connected jobs for user 'dev-user-multi'
        root_id = "job-seed-root-100"
        jobs_data = [
            (root_id, None, root_id, 1, "First task prompt", "done"),
            ("job-seed-it-101", root_id, root_id, 2, "Second task prompt", "done"),
            ("job-seed-it-102", "job-seed-it-101", root_id, 3, "Third task prompt", "done"),
            ("job-seed-it-103", "job-seed-it-102", root_id, 4, "Fourth task prompt", "working"),
        ]

        for jid, parent_id, rid, iter_num, prompt, status in jobs_data:
            record = {
                "id": jid,
                "userId": "multi",
                "fullPrompt": prompt,
                "promptPreview": prompt,
                "status": status,
                "progress": 100 if status == "done" else 50,
                "stepLabel": "Completed" if status == "done" else "Working",
                "partCount": 10,
                "mode": "ai",
                "createdAt": f"2026-10-19T12:0{iter_num}:00Z",
                "rootJobId": rid,
                "parentJobId": parent_id,
                "iteration": iter_num,
                "reassignments": 0,
                "crashedAttempts": 0,
            }
            await set_job_public(jid, record)
            await set_job_internal(jid, record)
            await set_part(jid, f"part-{jid}-1", {
                "partId": f"part-{jid}-1",
                "jobId": jid,
                "status": status,
                "nodeId": f"node-{iter_num}",
                "provider": "gemini",
                "model": "gemini-2.5-flash",
                "attempts": [{"nodeId": f"node-{iter_num}", "provider": "gemini", "model": "gemini-2.5-flash", "durationMs": 120}],
            })

        # 3. User lists their jobs - should return exactly 1 submission
        user_list_res = await client.get("/api/jobs", headers=user_headers)
        assert user_list_res.status_code == 200
        user_submissions = [s for s in user_list_res.json() if s.get("rootJobId") == root_id or s.get("id") == root_id]
        assert len(user_submissions) == 1
        assert user_submissions[0]["iterationCount"] == 4
        assert len(user_submissions[0]["iterations"]) == 4

        # 4. User views job detail - includes iterations
        detail_res = await client.get(f"/api/jobs/{root_id}", headers=user_headers)
        assert detail_res.status_code == 200
        detail_data = detail_res.json()
        assert detail_data["iterationCount"] == 4
        assert len(detail_data["iterations"]) == 4

        # 5. Admin lists submissions - should show 1 row for this submission with iterationCount = 4
        admin_list_res = await client.get("/api/admin/jobs", headers=admin_headers)
        assert admin_list_res.status_code == 200
        admin_subs = [s for s in admin_list_res.json() if s.get("rootJobId") == root_id or s.get("id") == root_id]
        assert len(admin_subs) == 1
        assert admin_subs[0]["iterationCount"] == 4
        assert len(admin_subs[0]["iterations"]) == 4

        # 6. Admin inspects job detail - includes iterations with detailed parts for each task
        admin_detail_res = await client.get(f"/api/admin/jobs/{root_id}", headers=admin_headers)
        assert admin_detail_res.status_code == 200
        admin_detail = admin_detail_res.json()
        assert admin_detail["iterationCount"] == 4
        assert len(admin_detail["iterations"]) == 4
        for it in admin_detail["iterations"]:
            assert "job" in it
            assert "parts" in it
            assert len(it["parts"]) >= 1
