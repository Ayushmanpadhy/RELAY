"use client";

import React from "react";
import { useAdminAuth } from "@/context/AdminAuthContext";
import { fetchWithAuth } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { User } from "lucide-react";
import { UserRecord } from "@/lib/types";

export default function AdminUsersPage() {
  const { token } = useAdminAuth();

  const { data: users = [] } = useQuery<UserRecord[]>({
    queryKey: ["adminUsers", token],
    queryFn: () => fetchWithAuth<UserRecord[]>("/admin/users", token),
    enabled: Boolean(token),
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Registered Users</h1>
        <p className="text-xs text-[var(--dim)] mt-0.5">
          User accounts and their historical job submission activity.
        </p>
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
            {users.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-8 text-center text-[var(--dim)]">
                  No registered users in current session.
                </td>
              </tr>
            ) : (
              users.map((u: UserRecord) => (
                <tr key={u.uid} className="hover:bg-[var(--surface-2)] transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[var(--surface-2)] border border-[var(--line)] flex items-center justify-center text-[var(--accent)]">
                        <User className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-[var(--text)]">{u.displayName || "User"}</p>
                        <p className="text-[11px] font-mono text-[var(--dim)]">{u.email}</p>
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
