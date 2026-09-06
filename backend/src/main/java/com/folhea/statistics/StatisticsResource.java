package com.folhea.statistics;

import com.folhea.identity.CurrentUser;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.security.SecurityRequirement;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

import java.time.LocalDate;

@Path("/api/v1")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
@Tag(name = "Statistics")
@SecurityRequirement(name = "bearerAuth")
public class StatisticsResource {
    @Inject CurrentUser currentUser;
    @Inject StatisticsService statistics;

    @GET @Path("/stats")
    @Operation(summary = "Retorna métricas do período")
    public StatisticsService.StatsResponse stats(@QueryParam("from") LocalDate from,
                                                 @QueryParam("to") LocalDate to,
                                                 @QueryParam("period") String period,
                                                 @QueryParam("range") String range) {
        if ((from == null) != (to == null) || (from != null && from.isAfter(to))) {
            throw new com.folhea.shared.ProblemException(400, "https://folhea.com.br/problems/invalid-period", "Período inválido", "Informe um período com datas válidas.");
        }
        if (period != null && range != null && !period.equalsIgnoreCase(range)) {
            throw new com.folhea.shared.ProblemException(400, "https://folhea.com.br/problems/invalid-period", "Período inválido", "Informe apenas um período.");
        }
        return statistics.stats(currentUser.get(), from, to, period != null ? period : range);
    }

    @GET @Path("/dashboard")
    @Operation(summary = "Retorna os dados resumidos da home")
    public StatisticsService.DashboardResponse dashboard() { return statistics.dashboard(currentUser.get()); }

    /** Convenience overload retained for callers using the explicit date-range API. */
    public StatisticsService.StatsResponse stats(LocalDate from, LocalDate to) {
        return stats(from, to, null, null);
    }
}
