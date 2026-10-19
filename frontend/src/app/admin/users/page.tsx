"use client";

import React, { useState } from "react";
import { useAdminAuth } from "@/context/AdminAuthContext";
import { fetchWithAuth } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { User, Search, RefreshCw, Users as UsersIcon } from "lucide-react";
import { UserRecord } from "@/lib/types";

export default function AdminUsersPage() {
  const { token } = useAdminAuth();
  const [search, setSearch] = useState("");

  const { data: users = [], refetch, isFetching } = useQuery<UserRecord[]>({
    queryKey: ["adminUsers", token],
    queryFn: () => fetchWithAuth<UserRecord[]>("/admin/users", token),
    enabled: Boolean(token),
    refetchInterval: 3000,
  });

  const filteredUsers = users.filter((u: UserRecord) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const matchEmail = (u.email || "").toLowerCase().includes(q);
    const matchName = (u.displayName || "").toLowerCase().includes(q);
    const matchUid = (u.uid || "").toLowerCase().includes(q);
    return matchEmail || matchName || matchUid;
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Registered Users</h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-[rgba(91,108,255,0.12)] text-[var(--accent)] border border-[rgba(91,108,255,0.2)]">
              <UsersIcon className="w-3 h-3" />
              <span>{users.length} Users</span>
            </span>
          </div>
          <p className="text-xs text-[var(--dim)] mt-0.5">
            Accounts discovered across Firebase Authentication, Firestore, and historical task submissions.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--dim)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search user or email..."
              className="bg-[var(--surface)] border border-[var(--line)] rounded-xl pl-9 pr-4 py-2 text-xs focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
            />
          </div>

          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh user list"
            className="p-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] hover:bg-[var(--surface-2)] text-[var(--dim)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin text-[var(--accent)]" : ""}`} />
          </button>
        </div>
      </div>

      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--line)] bg-[var(--surface-2)] text-[var(--dim)] font-mono uppercase tracking-wider text-[11px]">
              <th className="p-4">User</th>
              <th className="p-4">Role</th>
              <th className="p-4">Total Submissions</th>
              <th className="p-4">Created Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-8 text-center text-[var(--dim)]">
                  {search.trim() ? "No users matching your search." : "No registered users found."}
                </td>
              </tr>
            ) : (
              filteredUsers.map((u: UserRecord) => (
                <tr key={u.uid} className="hover:bg-[var(--surface-2)] transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[var(--surface-2)] border border-[var(--line)] flex items-center justify-center text-[var(--accent)] shrink-0 font-bold font-mono text-xs">
                        {(u.displayName || u.email || "U").substring(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-[var(--text)] truncate">{u.displayName || "User"}</p>
                        <p className="text-[11px] font-mono text-[var(--dim)] truncate">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase ${
                        u.role === "admin"
                          ? "bg-[rgba(124,140,255,0.15)] text-[var(--accent)]"
                          : "bg-[var(--surface-2)] text-[var(--dim)]"
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="p-4 font-mono font-bold text-[var(--text)]">{u.jobCount} jobs</td>
                  <td className="p-4 font-mono text-[var(--dim)]">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "Active"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
