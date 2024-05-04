#include "timer.h"
#include <libopencm3/stm32/timer.h>
#include <libopencm3/stm32/rcc.h>

/*  System frequency 84000000
    pwm_freq = system_freq / (prescaler * arr)
    1000 = 84000000 / (84 * 1000)
*/

#define PRESCALER (84)
#define ARR_VALUE (1000)

void timer_setup(void)
{
    rcc_periph_clock_enable(RCC_TIM2);

    /* High Level timer configuration*/
    timer_set_mode(TIM2, TIM_CR1_CKD_CK_INT, TIM_CR1_CMS_EDGE, TIM_CR1_DIR_UP);

    /* Setup PWM mode*/
    timer_set_oc_mode(TIM2, TIM_OC1, TIM_OCM_PWM1);

    /* Enable PWM output*/
    timer_enable_counter(TIM2);
    timer_enable_oc_output(TIM2, TIM_OC1);

    /* Set up frequency and resolution*/
    timer_set_prescaler(TIM2, PRESCALER - 1);
    timer_set_period(TIM2, ARR_VALUE - 1);
}

void timer_pwm_set_duty_cycle(float duty_cycle)
{
    /**
     * duty_cycle = (ccr / arr) * 100
     * duty_cycle / 100 = ccr / arr
     * (duty_cycle /100) * arr = ccr
     * ccr = (duty_cycle / 100) * arr
     */
    // if (duty_cycle < 0)
    // {
    //     duty_cycle = 0;
    // }
    // if (duty_cycle > 100)
    // {
    //     duty_cycle = 100;
    // }
    const float raw_value = (float)ARR_VALUE * (duty_cycle / 100.0f);
    timer_set_oc_value(TIM2, TIM_OC1, (uint32_t)raw_value);
}