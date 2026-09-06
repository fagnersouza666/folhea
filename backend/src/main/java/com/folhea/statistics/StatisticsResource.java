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
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

import java.time.LocalDate;

@Path("/api/v1")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
@Tag(name = "Statistics")
public class StatisticsResource {
    @Inject CurrentUser currentUser;
    @Inject StatisticsService statistics;

    @GET @Path("/stats")
    @Operation(summary = "Retorna métricas do período")
    public StatisticsService.StatsResponse stats(@QueryParam("from") LocalDate from, @QueryParam("to") LocalDate to) {
        if ((from == null) != (to == null) || (from != null && from.isAfter(to))) {
            throw new com.folhea.shared.ProblemException(400, "https://folhea.com.br/problems/invalid-period", "Período inválido", "Informe um período com datas válidas.");
        }
        return statistics.stats(currentUser.get(), from, to);
    }

    @GET @Path("/dashboard")
    @Operation(summary = "Retorna os dados resumidos da home")
    public StatisticsService.DashboardResponse dashboard() { return statistics.dashboard(currentUser.get()); }
}
