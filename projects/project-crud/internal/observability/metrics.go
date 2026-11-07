package observability

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	httpRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request latency.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "route", "status"},
	)

	httpRequestsInFlight = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "http_requests_in_flight",
			Help: "Number of HTTP requests currently being served.",
		},
	)
)

func init() {
	prometheus.MustRegister(httpRequestDuration, httpRequestsInFlight)
}

// Metrics is a Gin middleware that records request duration + in-flight counts.
func Metrics() gin.HandlerFunc {
	return func(c *gin.Context) {
		httpRequestsInFlight.Inc()
		start := time.Now()
		c.Next()
		httpRequestsInFlight.Dec()

		route := c.FullPath()
		if route == "" {
			route = "unknown"
		}
		httpRequestDuration.
			WithLabelValues(c.Request.Method, route, strconv.Itoa(c.Writer.Status())).
			Observe(time.Since(start).Seconds())
	}
}

func RegisterMetricsRoute(r gin.IRouter) {
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))
}
